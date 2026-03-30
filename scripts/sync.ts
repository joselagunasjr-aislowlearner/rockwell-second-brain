import * as path from 'path'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedClient } from './lib/auth'
import { fetchExistingSources } from './lib/brain'
import { syncDriveFiles } from './lib/drive'
import { syncGmailThreads } from './lib/gmail'

// Load .env from scripts directory
dotenv.config({ path: path.join(__dirname, '.env') })

// ─── Env validation ───────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DRIVE_SEARCH_KEYWORDS',
  'GMAIL_SEARCH_QUERY',
] as const

const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length > 0) {
  process.stderr.write(`[sync] Missing required env vars: ${missing.join(', ')}\n`)
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const DRIVE_SEARCH_KEYWORDS = process.env.DRIVE_SEARCH_KEYWORDS!
const GMAIL_SEARCH_QUERY = process.env.GMAIL_SEARCH_QUERY!

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const driveOnly = args.includes('--drive-only')
const gmailOnly = args.includes('--gmail-only')

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[sync] Starting Rockwell Cortex sync...')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  // Load existing sources for duplicate detection
  let existingSources: Set<string>
  try {
    existingSources = await fetchExistingSources(supabase)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[sync] Failed to load existing sources: ${msg}\n`)
    process.exit(1)
  }
  console.log(`[sync] Loaded ${existingSources.size} existing source URLs`)

  // Google OAuth
  let auth
  try {
    auth = await getAuthenticatedClient(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[sync] Google auth failed: ${msg}\n`)
    process.exit(1)
  }

  let driveSynced = 0
  let driveSkipped = 0
  let gmailSynced = 0
  let gmailSkipped = 0

  // Drive sync
  if (!gmailOnly) {
    const keywords = DRIVE_SEARCH_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean)
    try {
      const result = await syncDriveFiles(auth, anthropic, supabase, keywords, existingSources)
      driveSynced = result.synced
      driveSkipped = result.skipped
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[sync] Drive sync failed: ${msg}\n`)
      // Continue to Gmail if not drive-only
      if (driveOnly) process.exit(1)
    }
  }

  // Gmail sync
  if (!driveOnly) {
    try {
      const result = await syncGmailThreads(auth, anthropic, supabase, GMAIL_SEARCH_QUERY, existingSources)
      gmailSynced = result.synced
      gmailSkipped = result.skipped
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[sync] Gmail sync failed: ${msg}\n`)
      process.exit(1)
    }
  }

  // Summary report
  console.log('---')
  if (!gmailOnly) {
    console.log(`Drive:  ${driveSynced} synced, ${driveSkipped} skipped`)
  }
  if (!driveOnly) {
    console.log(`Gmail:  ${gmailSynced} synced, ${gmailSkipped} skipped`)
  }
  console.log('[sync] Done.')
}

main().catch((err) => {
  process.stderr.write(`[sync] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
