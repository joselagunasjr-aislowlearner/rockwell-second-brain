import { buildDriveQuery, getDriveSourceUrl, SUPPORTED_MIME_TYPES, syncDriveFiles } from '../drive'
import { SummarizeOutput } from '../types'

// ─── buildDriveQuery ─────────────────────────────────────────────────────────

describe('buildDriveQuery', () => {
  it('builds query for single keyword', () => {
    expect(buildDriveQuery(['SOP'])).toBe("fullText contains 'SOP'")
  })

  it('builds OR query for multiple keywords', () => {
    const q = buildDriveQuery(['SOP', 'audit', 'vendor'])
    expect(q).toBe("fullText contains 'SOP' or fullText contains 'audit' or fullText contains 'vendor'")
  })
})

// ─── getDriveSourceUrl ───────────────────────────────────────────────────────

describe('getDriveSourceUrl', () => {
  it('returns correct Drive URL format', () => {
    expect(getDriveSourceUrl('abc123')).toBe('https://drive.google.com/file/d/abc123/view')
  })
})

// ─── SUPPORTED_MIME_TYPES ────────────────────────────────────────────────────

describe('SUPPORTED_MIME_TYPES', () => {
  it('includes Google Docs MIME type', () => {
    expect(SUPPORTED_MIME_TYPES.has('application/vnd.google-apps.document')).toBe(true)
  })

  it('includes PDF MIME type', () => {
    expect(SUPPORTED_MIME_TYPES.has('application/pdf')).toBe(true)
  })

  it('includes plain text MIME type', () => {
    expect(SUPPORTED_MIME_TYPES.has('text/plain')).toBe(true)
  })

  it('does not include spreadsheets', () => {
    expect(SUPPORTED_MIME_TYPES.has('application/vnd.google-apps.spreadsheet')).toBe(false)
  })
})

// ─── syncDriveFiles ──────────────────────────────────────────────────────────

function makeValidSummary(): SummarizeOutput {
  return {
    title: 'Operations Guidebook',
    summary: 'Standard operating procedures.',
    category: 'strategy',
    importance: 3,
  }
}

function makeDriveClient(files: object[], exportText = 'document content') {
  return {
    files: {
      list: jest.fn().mockResolvedValue({ data: { files, nextPageToken: undefined } }),
      export: jest.fn().mockResolvedValue({ data: exportText }),
      get: jest.fn().mockResolvedValue({ data: exportText }),
    },
  }
}

function makeGoogleMock(driveClient: any) {
  return driveClient
}

function makeAnthropicMock(summary: SummarizeOutput) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(summary) }],
      }),
    },
  } as any
}

function makeSupabaseMock(id = 'uuid-1234') {
  const single = jest.fn().mockResolvedValue({ data: { id }, error: null })
  const select = jest.fn().mockReturnValue({ single })
  const insert = jest.fn().mockReturnValue({ select })
  return { from: jest.fn().mockReturnValue({ insert }) } as any
}

// We need to mock the googleapis module since syncDriveFiles uses google.drive internally
jest.mock('googleapis', () => {
  const mockDriveInstance = {
    files: {
      list: jest.fn(),
      export: jest.fn(),
      get: jest.fn(),
    },
  }
  return {
    google: {
      drive: jest.fn().mockReturnValue(mockDriveInstance),
    },
    drive_v3: {},
  }
})

import { google } from 'googleapis'

describe('syncDriveFiles', () => {
  const mockAuth = {} as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('inserts a new file and returns synced count', async () => {
    const files = [{ id: 'file-1', name: 'Operations Guide', mimeType: 'text/plain' }]
    const driveInstance = (google.drive as jest.Mock).mock.results[0]?.value ?? {
      files: {
        list: jest.fn().mockResolvedValue({ data: { files, nextPageToken: undefined } }),
        export: jest.fn(),
        get: jest.fn().mockResolvedValue({ data: 'file content' }),
      },
    }
    ;(google.drive as jest.Mock).mockReturnValue(driveInstance)
    driveInstance.files.list.mockResolvedValue({ data: { files } })
    driveInstance.files.get.mockResolvedValue({ data: 'file content' })

    const anthropic = makeAnthropicMock(makeValidSummary())
    const supabase = makeSupabaseMock()
    const existingSources = new Set<string>()

    const result = await syncDriveFiles(mockAuth, anthropic, supabase, ['SOP'], existingSources)

    expect(result.synced).toBe(1)
    expect(result.skipped).toBe(0)
    expect(existingSources.has('https://drive.google.com/file/d/file-1/view')).toBe(true)
  })

  it('skips duplicate files', async () => {
    const files = [{ id: 'file-1', name: 'Operations Guide', mimeType: 'text/plain' }]
    const driveInstance = {
      files: {
        list: jest.fn().mockResolvedValue({ data: { files } }),
        get: jest.fn(),
        export: jest.fn(),
      },
    }
    ;(google.drive as jest.Mock).mockReturnValue(driveInstance)

    const anthropic = makeAnthropicMock(makeValidSummary())
    const supabase = makeSupabaseMock()
    const existingSources = new Set(['https://drive.google.com/file/d/file-1/view'])

    const result = await syncDriveFiles(mockAuth, anthropic, supabase, ['SOP'], existingSources)

    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
    expect(driveInstance.files.get).not.toHaveBeenCalled()
  })

  it('skips unsupported MIME types', async () => {
    const files = [
      { id: 'file-1', name: 'Spreadsheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
    ]
    const driveInstance = {
      files: {
        list: jest.fn().mockResolvedValue({ data: { files } }),
        get: jest.fn(),
        export: jest.fn(),
      },
    }
    ;(google.drive as jest.Mock).mockReturnValue(driveInstance)

    const anthropic = makeAnthropicMock(makeValidSummary())
    const supabase = makeSupabaseMock()
    const existingSources = new Set<string>()

    const result = await syncDriveFiles(mockAuth, anthropic, supabase, ['SOP'], existingSources)

    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(0) // filtered before processing
    expect(driveInstance.files.get).not.toHaveBeenCalled()
  })
})
