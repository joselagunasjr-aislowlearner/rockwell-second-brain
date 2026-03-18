/**
 * Tests for Rockwell Second Brain MCP server.
 *
 * Strategy:
 * - Validation functions are exported from index.ts and tested directly (no mocking needed)
 * - Tool handler tests use jest.mock() to replace Supabase client and global fetch
 */

// Set env vars before any import
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.GOOGLE_EMBEDDING_API_KEY = 'test-google-key'

// Mock @supabase/supabase-js before import
const mockRpc = jest.fn()
const mockSingle = jest.fn()
const mockSelect = jest.fn()
const mockInsert = jest.fn()
const mockOrder = jest.fn()
const mockLimit = jest.fn()
const mockEq = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: mockRpc,
    from: jest.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
    })),
  })),
}))

// Mock @modelcontextprotocol/sdk to prevent STDIO side effects during tests
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}))
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}))

import {
  VALID_CATEGORIES,
  validateSearchArgs,
  validateAddEntryArgs,
  validateListArgs,
  handleTool,
} from '../index'

// ─── VALID_CATEGORIES ──────────────────────────────────────────────────────────

describe('VALID_CATEGORIES', () => {
  it('contains all 8 expected categories', () => {
    expect(VALID_CATEGORIES).toEqual(
      expect.arrayContaining([
        'decision', 'contact', 'lesson', 'open_thread',
        'vendor', 'client', 'strategy', 'daily_note',
      ])
    )
    expect(VALID_CATEGORIES).toHaveLength(8)
  })
})

// ─── validateSearchArgs ────────────────────────────────────────────────────────

describe('validateSearchArgs', () => {
  it('returns error when query is missing', () => {
    const result = validateSearchArgs({})
    expect(result).toEqual({ error: expect.stringContaining('query') })
  })

  it('returns error when query is empty string', () => {
    const result = validateSearchArgs({ query: '   ' })
    expect(result).toEqual({ error: expect.stringContaining('query') })
  })

  it('returns error when query exceeds 500 characters', () => {
    const result = validateSearchArgs({ query: 'a'.repeat(501) })
    expect(result).toEqual({ error: expect.stringContaining('500') })
  })

  it('returns defaults when only query is provided', () => {
    const result = validateSearchArgs({ query: 'insurance compliance' })
    expect(result).toEqual({ query: 'insurance compliance', limit: 10 })
  })

  it('clamps limit to maximum of 20', () => {
    const result = validateSearchArgs({ query: 'test', limit: 100 })
    expect(result).toEqual({ query: 'test', limit: 20 })
  })

  it('clamps limit to minimum of 1', () => {
    const result = validateSearchArgs({ query: 'test', limit: 0 })
    expect(result).toEqual({ query: 'test', limit: 1 })
  })
})

// ─── validateAddEntryArgs ──────────────────────────────────────────────────────

describe('validateAddEntryArgs', () => {
  const validArgs = {
    title: 'Test decision',
    content: 'Test content here',
    category: 'decision',
  }

  it('returns error when title is missing', () => {
    const result = validateAddEntryArgs({ ...validArgs, title: undefined })
    expect(result).toEqual({ error: expect.stringContaining('title') })
  })

  it('returns error when title exceeds 500 characters', () => {
    const result = validateAddEntryArgs({ ...validArgs, title: 'a'.repeat(501) })
    expect(result).toEqual({ error: expect.stringContaining('500') })
  })

  it('returns error when content is missing', () => {
    const result = validateAddEntryArgs({ ...validArgs, content: undefined })
    expect(result).toEqual({ error: expect.stringContaining('content') })
  })

  it('returns error when content exceeds 10000 characters', () => {
    const result = validateAddEntryArgs({ ...validArgs, content: 'a'.repeat(10001) })
    expect(result).toEqual({ error: expect.stringContaining('10,000') })
  })

  it('returns error when category is invalid', () => {
    const result = validateAddEntryArgs({ ...validArgs, category: 'invalid_category' })
    expect(result).toEqual({ error: expect.stringContaining('category') })
  })

  it('returns error when tags exceed 20 items', () => {
    const result = validateAddEntryArgs({ ...validArgs, tags: Array(21).fill('tag') })
    expect(result).toEqual({ error: expect.stringContaining('20') })
  })

  it('returns validated args with defaults on minimal valid input', () => {
    const result = validateAddEntryArgs(validArgs)
    expect(result).toMatchObject({
      title: 'Test decision',
      content: 'Test content here',
      category: 'decision',
      tags: [],
      importance: 3,
      source: null,
    })
  })

  it('clamps importance to range 1-5', () => {
    const result = validateAddEntryArgs({ ...validArgs, importance: 99 }) as Record<string, unknown>
    expect(result.importance).toBe(5)
  })

  it('accepts all 8 valid categories', () => {
    for (const category of VALID_CATEGORIES) {
      const result = validateAddEntryArgs({ ...validArgs, category })
      expect(result).not.toHaveProperty('error')
    }
  })
})

// ─── validateListArgs ──────────────────────────────────────────────────────────

describe('validateListArgs', () => {
  it('returns defaults when no args provided', () => {
    const result = validateListArgs({})
    expect(result).toEqual({ limit: 10, category: undefined })
  })

  it('clamps limit to maximum of 50', () => {
    const result = validateListArgs({ limit: 200 })
    expect(result).toEqual({ limit: 50, category: undefined })
  })

  it('returns error when category is invalid', () => {
    const result = validateListArgs({ category: 'not_a_real_category' })
    expect(result).toEqual({ error: expect.stringContaining('category') })
  })

  it('accepts valid category filter', () => {
    const result = validateListArgs({ category: 'strategy' })
    expect(result).toEqual({ limit: 10, category: 'strategy' })
  })
})

// ─── handleTool — search_brain ─────────────────────────────────────────────────

describe('handleTool: search_brain', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns error result for empty query', async () => {
    const result = await handleTool('search_brain', { query: '' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/query/)
  })

  it('returns error result when Google API fails', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'API key invalid',
    } as unknown as Response)

    const result = await handleTool('search_brain', { query: 'insurance compliance' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Error/)
  })

  it('returns results on success', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: { values: Array(768).fill(0.1) } }),
    } as unknown as Response)

    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'abc', title: 'Insurance policy', rrf_score: 0.05 }],
      error: null,
    })

    const result = await handleTool('search_brain', { query: 'insurance compliance' })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Insurance policy')
  })
})

// ─── handleTool — add_entry ────────────────────────────────────────────────────

describe('handleTool: add_entry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns error result for missing title', async () => {
    const result = await handleTool('add_entry', {
      content: 'Some content',
      category: 'decision',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/title/)
  })

  it('returns error result for invalid category', async () => {
    const result = await handleTool('add_entry', {
      title: 'Test',
      content: 'Content',
      category: 'bad_category',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/category/)
  })

  it('returns created entry on success', async () => {
    const mockSingleFn = jest.fn().mockResolvedValueOnce({
      data: { id: 'new-uuid', created_at: '2026-03-17T00:00:00Z' },
      error: null,
    })
    mockInsert.mockReturnValue({ select: jest.fn().mockReturnValue({ single: mockSingleFn }) })

    const result = await handleTool('add_entry', {
      title: 'New decision',
      content: 'We decided to do X',
      category: 'decision',
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('new-uuid')
  })
})

// ─── handleTool — list_entries ─────────────────────────────────────────────────

describe('handleTool: list_entries', () => {
  it('returns error result for invalid category filter', async () => {
    const result = await handleTool('list_entries', { category: 'invalid' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/category/)
  })

  it('returns error for unknown tool name', async () => {
    const result = await handleTool('unknown_tool', {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Unknown tool/)
  })
})
