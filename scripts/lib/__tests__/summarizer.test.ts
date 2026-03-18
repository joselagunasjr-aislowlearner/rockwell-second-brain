import { parseAndValidate, summarize } from '../summarizer'
import { SummarizeInput } from '../types'

// ─── parseAndValidate ────────────────────────────────────────────────────────

describe('parseAndValidate', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      title: 'Vendor Contract Review',
      summary: 'Reviewed contract with Acme Corp. Key terms: 12-month term, auto-renewal.',
      category: 'vendor',
      importance: 4,
    })
    const result = parseAndValidate(raw)
    expect(result.title).toBe('Vendor Contract Review')
    expect(result.category).toBe('vendor')
    expect(result.importance).toBe(4)
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n{"title":"T","summary":"S","category":"decision","importance":3}\n```'
    const result = parseAndValidate(raw)
    expect(result.title).toBe('T')
    expect(result.category).toBe('decision')
  })

  it('throws on invalid category', () => {
    const raw = JSON.stringify({
      title: 'T',
      summary: 'S',
      category: 'not_a_category',
      importance: 3,
    })
    expect(() => parseAndValidate(raw)).toThrow('invalid category')
  })

  it('throws on invalid importance (out of range)', () => {
    const raw = JSON.stringify({ title: 'T', summary: 'S', category: 'decision', importance: 6 })
    expect(() => parseAndValidate(raw)).toThrow('invalid importance')
  })

  it('throws on missing title', () => {
    const raw = JSON.stringify({ summary: 'S', category: 'decision', importance: 3 })
    expect(() => parseAndValidate(raw)).toThrow('missing or invalid title')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseAndValidate('not json')).toThrow('invalid JSON')
  })
})

// ─── summarize ───────────────────────────────────────────────────────────────

function makeClaudeResponse(content: string) {
  return {
    content: [{ type: 'text', text: content }],
  }
}

function makeValidResponse() {
  return JSON.stringify({
    title: 'Operations Guidebook Summary',
    summary: 'Standard operating procedures for daily operations including opening and closing.',
    category: 'strategy',
    importance: 3,
  })
}

describe('summarize', () => {
  it('summarizes drive content', async () => {
    const mockCreate = jest.fn().mockResolvedValue(makeClaudeResponse(makeValidResponse()))
    const client = { messages: { create: mockCreate } } as any

    const input: SummarizeInput = {
      contentType: 'drive',
      rawText: 'Operations content here',
      metadata: { filename: 'Operations Guidebook.pdf' },
    }

    const result = await summarize(client, input)
    expect(result.title).toBe('Operations Guidebook Summary')
    expect(result.category).toBe('strategy')
    expect(mockCreate).toHaveBeenCalledTimes(1)

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Filename: Operations Guidebook.pdf')
  })

  it('summarizes gmail content', async () => {
    const mockCreate = jest.fn().mockResolvedValue(
      makeClaudeResponse(
        JSON.stringify({
          title: 'Client onboarding discussion',
          summary: 'Discussed onboarding timeline and requirements.',
          category: 'client',
          importance: 4,
        })
      )
    )
    const client = { messages: { create: mockCreate } } as any

    const input: SummarizeInput = {
      contentType: 'gmail',
      rawText: 'Email thread content',
      metadata: { senders: ['alice@example.com', 'bob@example.com'], dateRange: '2025-01-01 to 2025-01-10' },
    }

    const result = await summarize(client, input)
    expect(result.category).toBe('client')
    expect(result.importance).toBe(4)

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Senders: alice@example.com, bob@example.com')
    expect(callArgs.messages[0].content).toContain('Date range: 2025-01-01 to 2025-01-10')
  })

  it('retries once on 429 and succeeds', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 })
    const mockCreate = jest
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(makeClaudeResponse(makeValidResponse()))

    const client = { messages: { create: mockCreate } } as any

    const input: SummarizeInput = {
      contentType: 'drive',
      rawText: 'Content',
      metadata: {},
    }

    const result = await summarize(client, input)
    expect(result.title).toBe('Operations Guidebook Summary')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('throws after retry if 429 persists', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 })
    const mockCreate = jest.fn().mockRejectedValue(rateLimitError)

    const client = { messages: { create: mockCreate } } as any

    const input: SummarizeInput = {
      contentType: 'drive',
      rawText: 'Content',
      metadata: {},
    }

    await expect(summarize(client, input)).rejects.toThrow('rate limited')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  }, 10_000)
})
