import { getGmailSourceUrl, extractPlainTextParts, formatThreadMessages, syncGmailThreads } from '../gmail'
import { gmail_v1 } from 'googleapis'

// ─── getGmailSourceUrl ───────────────────────────────────────────────────────

describe('getGmailSourceUrl', () => {
  it('returns correct Gmail URL format', () => {
    expect(getGmailSourceUrl('abc123')).toBe('https://mail.google.com/mail/u/0/#inbox/abc123')
  })
})

// ─── extractPlainTextParts ───────────────────────────────────────────────────

function base64(text: string): string {
  return Buffer.from(text).toString('base64')
}

describe('extractPlainTextParts', () => {
  it('extracts text from simple text/plain part', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/plain',
      body: { data: base64('Hello world') },
    }
    expect(extractPlainTextParts(payload)).toBe('Hello world')
  })

  it('extracts text from nested multipart structure', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: base64('Plain text here') } },
            { mimeType: 'text/html', body: { data: base64('<p>HTML here</p>') } },
          ],
        },
      ],
    }
    const result = extractPlainTextParts(payload)
    expect(result).toContain('Plain text here')
    expect(result).not.toContain('<p>')
  })

  it('returns empty string when no text/plain parts', () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/html',
      body: { data: base64('<p>HTML only</p>') },
    }
    expect(extractPlainTextParts(payload)).toBe('')
  })
})

// ─── formatThreadMessages ────────────────────────────────────────────────────

function makeMessage(
  id: string,
  from: string,
  date: string,
  internalDate: string,
  bodyText: string
): gmail_v1.Schema$Message {
  return {
    id,
    internalDate,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: from },
        { name: 'Date', value: date },
      ],
      body: { data: base64(bodyText) },
    },
  }
}

describe('formatThreadMessages', () => {
  it('orders messages oldest first', () => {
    const newer = makeMessage('2', 'bob@test.com', 'Mon, 2 Jan 2025', '1735776000000', 'Reply')
    const older = makeMessage('1', 'alice@test.com', 'Sun, 1 Jan 2025', '1735689600000', 'Original')

    const { formatted } = formatThreadMessages([newer, older])
    expect(formatted[0].sender).toBe('alice@test.com')
    expect(formatted[1].sender).toBe('bob@test.com')
  })

  it('collects unique senders', () => {
    const msg1 = makeMessage('1', 'alice@test.com', 'Sun, 1 Jan 2025', '1735689600000', 'Hi')
    const msg2 = makeMessage('2', 'bob@test.com', 'Mon, 2 Jan 2025', '1735776000000', 'Reply')
    const msg3 = makeMessage('3', 'alice@test.com', 'Tue, 3 Jan 2025', '1735862400000', 'Follow up')

    const { senders } = formatThreadMessages([msg1, msg2, msg3])
    expect(senders).toContain('alice@test.com')
    expect(senders).toContain('bob@test.com')
    expect(senders.length).toBe(2) // alice deduplicated
  })

  it('computes dateRange for multi-day thread', () => {
    const msg1 = makeMessage('1', 'alice@test.com', 'Sun, 1 Jan 2025', '1735689600000', 'Hi')
    const msg2 = makeMessage('2', 'bob@test.com', 'Mon, 3 Jan 2025', '1735862400000', 'Reply')

    const { dateRange } = formatThreadMessages([msg1, msg2])
    expect(dateRange).toMatch(/2025-01-01 to 2025-01-0/)
  })
})

// ─── syncGmailThreads ────────────────────────────────────────────────────────

jest.mock('googleapis', () => {
  const mockGmailInstance = {
    users: {
      threads: {
        list: jest.fn(),
        get: jest.fn(),
      },
    },
  }
  return {
    google: {
      gmail: jest.fn().mockReturnValue(mockGmailInstance),
    },
    gmail_v1: {},
  }
})

import { google } from 'googleapis'

function makeAnthropicMock() {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              title: 'Client onboarding thread',
              summary: 'Discussion about onboarding timeline.',
              category: 'client',
              importance: 4,
            }),
          },
        ],
      }),
    },
  } as any
}

function makeSupabaseMock() {
  const single = jest.fn().mockResolvedValue({ data: { id: 'uuid-5678' }, error: null })
  const select = jest.fn().mockReturnValue({ single })
  const insert = jest.fn().mockReturnValue({ select })
  return { from: jest.fn().mockReturnValue({ insert }) } as any
}

describe('syncGmailThreads', () => {
  const mockAuth = {} as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('syncs a new thread', async () => {
    const gmailInstance = (google.gmail as jest.Mock).mock.results[0]?.value ?? {
      users: { threads: { list: jest.fn(), get: jest.fn() } },
    }
    ;(google.gmail as jest.Mock).mockReturnValue(gmailInstance)

    gmailInstance.users.threads.list.mockResolvedValue({
      data: { threads: [{ id: 'thread-1' }] },
    })
    gmailInstance.users.threads.get.mockResolvedValue({
      data: {
        messages: [
          makeMessage('1', 'alice@test.com', 'Sun, 1 Jan 2025', '1735689600000', 'Hello'),
        ],
      },
    })

    const anthropic = makeAnthropicMock()
    const supabase = makeSupabaseMock()
    const existingSources = new Set<string>()

    const result = await syncGmailThreads(mockAuth, anthropic, supabase, 'from:alice', existingSources)

    expect(result.synced).toBe(1)
    expect(result.skipped).toBe(0)
    expect(existingSources.has('https://mail.google.com/mail/u/0/#inbox/thread-1')).toBe(true)
  })

  it('skips a duplicate thread', async () => {
    const gmailInstance = {
      users: { threads: { list: jest.fn(), get: jest.fn() } },
    }
    ;(google.gmail as jest.Mock).mockReturnValue(gmailInstance)

    gmailInstance.users.threads.list.mockResolvedValue({
      data: { threads: [{ id: 'thread-1' }] },
    })

    const anthropic = makeAnthropicMock()
    const supabase = makeSupabaseMock()
    const existingSources = new Set(['https://mail.google.com/mail/u/0/#inbox/thread-1'])

    const result = await syncGmailThreads(mockAuth, anthropic, supabase, 'from:alice', existingSources)

    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
    expect(gmailInstance.users.threads.get).not.toHaveBeenCalled()
  })
})
