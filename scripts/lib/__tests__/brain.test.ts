import { truncate, fetchExistingSources, insertEntry } from '../brain'
import { KnowledgeEntry } from '../types'

// ─── truncate ───────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('returns string unchanged when under limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates string with ellipsis when over limit', () => {
    const result = truncate('hello world', 8)
    expect(result).toBe('hello w…')
    expect(result.length).toBe(8)
  })

  it('returns string unchanged at exact limit', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })
})

// ─── fetchExistingSources ────────────────────────────────────────────────────

function makeSupabaseMock(selectResult: { data: unknown; error: unknown }) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(selectResult),
    }),
  } as any
}

function makeInsertMock(insertResult: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(insertResult)
  const select = jest.fn().mockReturnValue({ single })
  const insert = jest.fn().mockReturnValue({ select })
  return {
    from: jest.fn().mockReturnValue({ insert }),
  } as any
}

describe('fetchExistingSources', () => {
  it('returns a Set of existing source URLs', async () => {
    const supabase = makeSupabaseMock({
      data: [
        { source: 'https://drive.google.com/file/d/abc/view' },
        { source: 'https://mail.google.com/mail/u/0/#inbox/xyz' },
      ],
      error: null,
    })

    const result = await fetchExistingSources(supabase)
    expect(result).toBeInstanceOf(Set)
    expect(result.has('https://drive.google.com/file/d/abc/view')).toBe(true)
    expect(result.has('https://mail.google.com/mail/u/0/#inbox/xyz')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('throws on Supabase error', async () => {
    const supabase = makeSupabaseMock({
      data: null,
      error: { message: 'connection refused' },
    })

    await expect(fetchExistingSources(supabase)).rejects.toThrow('connection refused')
  })

  it('filters out null source values', async () => {
    const supabase = makeSupabaseMock({
      data: [{ source: null }, { source: 'https://drive.google.com/file/d/abc/view' }],
      error: null,
    })

    const result = await fetchExistingSources(supabase)
    expect(result.size).toBe(1)
    expect(result.has('https://drive.google.com/file/d/abc/view')).toBe(true)
  })
})

// ─── insertEntry ─────────────────────────────────────────────────────────────

const sampleEntry: KnowledgeEntry = {
  title: 'Test Entry',
  content: 'Test content',
  category: 'decision',
  tags: ['test'],
  importance: 3,
  source: 'https://drive.google.com/file/d/abc/view',
}

describe('insertEntry', () => {
  it('returns the new entry id on success', async () => {
    const supabase = makeInsertMock({
      data: { id: 'uuid-1234' },
      error: null,
    })

    const id = await insertEntry(supabase, sampleEntry)
    expect(id).toBe('uuid-1234')
  })

  it('throws on Supabase error', async () => {
    const supabase = makeInsertMock({
      data: null,
      error: { message: 'insert failed' },
    })

    await expect(insertEntry(supabase, sampleEntry)).rejects.toThrow('insert failed')
  })
})
