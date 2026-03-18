import { gmail_v1, google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'
import { summarize } from './summarizer'
import { insertEntry } from './brain'
import { MAX_RAW_TEXT_LENGTH } from './types'

export function getGmailSourceUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`
}

export interface FormattedMessage {
  sender: string
  date: string
  body: string
}

export function extractPlainTextParts(payload: gmail_v1.Schema$MessagePart): string {
  if (!payload) return ''

  // Direct text/plain part
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }

  // Recurse into multipart
  if (payload.parts && payload.parts.length > 0) {
    return payload.parts.map((part) => extractPlainTextParts(part)).join('\n')
  }

  return ''
}

export function formatThreadMessages(messages: gmail_v1.Schema$Message[]): {
  formatted: FormattedMessage[]
  senders: string[]
  dateRange: string
} {
  // Sort oldest first
  const sorted = [...messages].sort((a, b) => {
    const aDate = parseInt(a.internalDate ?? '0')
    const bDate = parseInt(b.internalDate ?? '0')
    return aDate - bDate
  })

  const formatted: FormattedMessage[] = []
  const senderSet = new Set<string>()

  for (const msg of sorted) {
    const headers = msg.payload?.headers ?? []
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? 'Unknown'
    const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value ?? ''

    const body = extractPlainTextParts(msg.payload ?? {})
    senderSet.add(from)
    formatted.push({ sender: from, date, body })
  }

  const dates = sorted
    .map((m) => parseInt(m.internalDate ?? '0'))
    .filter((d) => d > 0)

  let dateRange = ''
  if (dates.length > 0) {
    const earliest = new Date(Math.min(...dates)).toISOString().slice(0, 10)
    const latest = new Date(Math.max(...dates)).toISOString().slice(0, 10)
    dateRange = earliest === latest ? earliest : `${earliest} to ${latest}`
  }

  return { formatted, senders: Array.from(senderSet), dateRange }
}

export interface GmailResult {
  synced: number
  skipped: number
}

export async function syncGmailThreads(
  auth: OAuth2Client,
  anthropic: Anthropic,
  supabase: SupabaseClient,
  searchQuery: string,
  existingSources: Set<string>
): Promise<GmailResult> {
  const gmailClient = google.gmail({ version: 'v1', auth })

  const listRes = await gmailClient.users.threads.list({
    userId: 'me',
    q: searchQuery,
    maxResults: 50,
  })

  const threads = listRes.data.threads ?? []
  console.log(`[Gmail] Found ${threads.length} threads matching search`)

  let synced = 0
  let skipped = 0

  for (const thread of threads) {
    const threadId = thread.id!
    const sourceUrl = getGmailSourceUrl(threadId)

    if (existingSources.has(sourceUrl)) {
      console.log(`[Gmail] Skipped (duplicate): thread ${threadId}`)
      skipped++
      continue
    }

    let messages: gmail_v1.Schema$Message[]
    try {
      const threadRes = await gmailClient.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      })
      messages = threadRes.data.messages ?? []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Gmail] [SKIP] thread ${threadId} — fetch error: ${msg}\n`)
      skipped++
      continue
    }

    const { formatted, senders, dateRange } = formatThreadMessages(messages)

    const rawText = formatted
      .map((m) => `From: ${m.sender}\nDate: ${m.date}\n\n${m.body}`)
      .join('\n\n---\n\n')
      .slice(0, MAX_RAW_TEXT_LENGTH)

    if (!rawText.trim()) {
      process.stderr.write(`[Gmail] [SKIP] thread ${threadId} — no text content\n`)
      skipped++
      continue
    }

    let output
    try {
      output = await summarize(anthropic, {
        contentType: 'gmail',
        rawText,
        metadata: { senders, dateRange },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Gmail] [SKIP] thread ${threadId} — Claude error: ${msg}\n`)
      skipped++
      continue
    }

    try {
      await insertEntry(supabase, {
        title: output.title,
        content: output.summary,
        category: output.category,
        importance: output.importance,
        source: sourceUrl,
      })
      existingSources.add(sourceUrl)
      console.log(`[Gmail] Synced: "${output.title}"`)
      synced++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Gmail] [SKIP] thread ${threadId} — DB error: ${msg}\n`)
      skipped++
    }
  }

  return { synced, skipped }
}
