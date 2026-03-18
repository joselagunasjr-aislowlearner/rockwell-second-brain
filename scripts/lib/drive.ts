import { drive_v3, google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'
import { summarize } from './summarizer'
import { insertEntry } from './brain'
import { MAX_RAW_TEXT_LENGTH } from './types'

export const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/pdf',
  'text/plain',
])

const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/pdf': 'text/plain',
  'text/plain': 'text/plain',
}

export function getDriveSourceUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

export function buildDriveQuery(keywords: string[]): string {
  return keywords
    .map((kw) => `fullText contains '${kw.replace(/'/g, "\\'")}'`)
    .join(' or ')
}

export async function searchDriveFiles(
  driveClient: drive_v3.Drive,
  keywords: string[]
): Promise<drive_v3.Schema$File[]> {
  const q = buildDriveQuery(keywords)
  const files: drive_v3.Schema$File[] = []
  let pageToken: string | undefined

  do {
    const res = await driveClient.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 100,
      pageToken,
    })
    files.push(...(res.data.files ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

export async function extractPlainText(
  driveClient: drive_v3.Drive,
  file: drive_v3.Schema$File
): Promise<string> {
  const mimeType = file.mimeType ?? ''
  const exportMime = EXPORT_MIME[mimeType]

  let res
  if (mimeType === 'application/vnd.google-apps.document') {
    res = await driveClient.files.export(
      { fileId: file.id!, mimeType: exportMime },
      { responseType: 'text' }
    )
  } else {
    res = await driveClient.files.get(
      { fileId: file.id!, alt: 'media' },
      { responseType: 'text' }
    )
  }

  const text = typeof res.data === 'string' ? res.data : String(res.data)
  return text.slice(0, MAX_RAW_TEXT_LENGTH)
}

export interface DriveResult {
  synced: number
  skipped: number
}

export async function syncDriveFiles(
  auth: OAuth2Client,
  anthropic: Anthropic,
  supabase: SupabaseClient,
  keywords: string[],
  existingSources: Set<string>
): Promise<DriveResult> {
  const driveClient = google.drive({ version: 'v3', auth })

  const files = await searchDriveFiles(driveClient, keywords)
  const supported = files.filter((f) => SUPPORTED_MIME_TYPES.has(f.mimeType ?? ''))
  console.log(`[Drive] Found ${supported.length} supported files matching search`)

  let synced = 0
  let skipped = 0

  for (const file of supported) {
    const sourceUrl = getDriveSourceUrl(file.id!)

    if (existingSources.has(sourceUrl)) {
      console.log(`[Drive] Skipped (duplicate): "${file.name}"`)
      skipped++
      continue
    }

    let rawText: string
    try {
      rawText = await extractPlainText(driveClient, file)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Drive] [SKIP] "${file.name}" — extract error: ${msg}\n`)
      skipped++
      continue
    }

    let output
    try {
      output = await summarize(anthropic, {
        contentType: 'drive',
        rawText,
        metadata: { filename: file.name ?? undefined },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Drive] [SKIP] "${file.name}" — Claude error: ${msg}\n`)
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
      console.log(`[Drive] Synced: "${output.title}"`)
      synced++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[Drive] [SKIP] "${file.name}" — DB error: ${msg}\n`)
      skipped++
    }
  }

  return { synced, skipped }
}
