import Anthropic from '@anthropic-ai/sdk'
import { SummarizeInput, SummarizeOutput, VALID_CATEGORIES, KnowledgeCategory, MAX_RAW_TEXT_LENGTH } from './types'

const RETRY_DELAY_MS = 500

const SYSTEM_PROMPT = `You are a business knowledge extraction assistant. Given business document or email content, extract structured knowledge.

Return ONLY valid JSON with these exact fields:
{
  "title": "concise title (max 255 chars)",
  "summary": "detailed summary of key information (max 2000 chars)",
  "category": "one of: decision, contact, lesson, open_thread, vendor, client, strategy, daily_note",
  "importance": <integer 1-5 where 5 is most critical>
}

Guidelines:
- title: short, descriptive, factual
- summary: capture decisions made, key people, outcomes, action items, dates
- category: choose the most fitting one based on content
- importance: 5=critical business decision/contract, 4=important, 3=standard, 2=minor, 1=trivial
- Return ONLY the JSON object, no markdown fences, no extra text`

export function parseAndValidate(raw: string): SummarizeOutput {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`)
  }

  const { title, summary, category, importance } = parsed

  if (typeof title !== 'string' || !title) {
    throw new Error('Claude response missing or invalid title')
  }
  if (typeof summary !== 'string' || !summary) {
    throw new Error('Claude response missing or invalid summary')
  }
  if (!VALID_CATEGORIES.includes(category as KnowledgeCategory)) {
    throw new Error(`Claude returned invalid category: ${category}`)
  }
  const imp = Number(importance)
  if (!Number.isInteger(imp) || imp < 1 || imp > 5) {
    throw new Error(`Claude returned invalid importance: ${importance}`)
  }

  return {
    title,
    summary,
    category: category as KnowledgeCategory,
    importance: imp as 1 | 2 | 3 | 4 | 5,
  }
}

export async function summarize(
  client: Anthropic,
  input: SummarizeInput
): Promise<SummarizeOutput> {
  const truncatedText =
    input.rawText.length > MAX_RAW_TEXT_LENGTH
      ? input.rawText.slice(0, MAX_RAW_TEXT_LENGTH) + '\n[Content truncated]'
      : input.rawText

  const contextLines: string[] = []
  if (input.contentType === 'drive' && input.metadata.filename) {
    contextLines.push(`Filename: ${input.metadata.filename}`)
  }
  if (input.contentType === 'gmail') {
    if (input.metadata.senders?.length) {
      contextLines.push(`Senders: ${input.metadata.senders.join(', ')}`)
    }
    if (input.metadata.dateRange) {
      contextLines.push(`Date range: ${input.metadata.dateRange}`)
    }
  }

  const userMessage = [
    contextLines.length ? contextLines.join('\n') + '\n\n---\n\n' : '',
    truncatedText,
  ].join('')

  const callClaude = () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

  let response
  try {
    response = await callClaude()
  } catch (err: any) {
    // Retry once on rate-limit (429)
    if (err?.status === 429) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      response = await callClaude()
    } else {
      throw err
    }
  }

  const textContent = response.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude returned no text content')
  }

  return parseAndValidate(textContent.text)
}
