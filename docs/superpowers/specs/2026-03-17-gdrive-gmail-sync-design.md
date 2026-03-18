# Google Drive + Gmail → Second Brain Sync Script

**Date:** 2026-03-17
**Status:** Approved
**Location:** `rockwell-second-brain/scripts/sync.ts`

---

## Overview

A TypeScript CLI script that pulls business documents from Google Drive and important email threads from Gmail, summarizes them using Claude, and pushes them as knowledge entries into the Rockwell Second Brain (Supabase). Run on demand — never automatic. Designed to be safe, idempotent, and PII-conscious.

---

## Architecture

### File Structure

```
rockwell-second-brain/
  scripts/
    sync.ts              # CLI entrypoint — orchestrates the full run
    seed.ts              # existing (unchanged)
    lib/
      auth.ts            # Google OAuth 2.0 flow (token storage + refresh)
      drive.ts           # Drive search and content extraction
      gmail.ts           # Gmail thread search and message fetching
      summarizer.ts      # Claude API (Haiku) wrapper
      brain.ts           # Supabase read (existing sources) + write (new entries)
      types.ts           # Shared TypeScript types
  .credentials/          # gitignored — stores OAuth token locally
  .env                   # gitignored — all secrets
```

### Run Command

```bash
npx tsx scripts/sync.ts           # sync both Drive and Gmail
npx tsx scripts/sync.ts --drive-only
npx tsx scripts/sync.ts --gmail-only
```

### End-to-End Flow

1. Validate all required env vars — exit with named error if any missing
2. Google OAuth handshake — browser flow on first run, silent refresh on subsequent runs
3. Load all existing `source` URLs from Supabase `knowledge_entries` into a Set (duplicate guard)
4. **Drive:** search by keywords → extract text → summarize via Claude → filter duplicates → insert individually
5. **Gmail:** search by query → fetch threads → summarize via Claude → filter duplicates → insert individually
6. Print summary report to stdout

**Insert strategy:** Entries are inserted one at a time (not batched). Each insert is independent — a failure on one item is logged and skipped without affecting others. No rollback needed; partial syncs are safe because duplicate detection prevents re-insertion on the next run.

---

## Configuration & Environment Variables

All secrets in `.env` (gitignored). Validated at startup before any API call.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Claude Haiku summarization |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `DRIVE_SEARCH_KEYWORDS` | Comma-separated search terms (e.g. `SOP,operations,audit,vendor,guidebook`) |
| `GMAIL_SEARCH_QUERY` | Gmail search string (e.g. `from:vendor@example.com OR subject:agreement`) |

### OAuth Token Storage

After first browser authorization, the refresh token is saved to `.credentials/google-oauth-token.json` (gitignored). Subsequent runs load and refresh silently.

**Token expiry:** Google refresh tokens expire after 6 months of inactivity. If the stored token is invalid or expired, the script detects the auth error at startup, deletes the stale token file, and triggers the browser OAuth flow again with a clear message: `"Google credentials expired — re-authorizing in browser…"`

### Google OAuth Scopes

- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`

Read-only. No write access to Google data.

### Duplicate Detection

Source URLs are stored in the `source` field of `knowledge_entries`:

- Drive: `https://drive.google.com/file/d/{fileId}/view`
- Gmail: `https://mail.google.com/mail/u/0/#inbox/{threadId}`

On each run, the script loads all existing source values into a Set and skips any item whose source URL already exists.

**Scale note:** This is a personal knowledge base. Loading all sources into memory is safe up to ~10,000 entries. At that scale the query is fast and memory usage is negligible. No pagination strategy is needed for this use case.

---

## Content Handling & Summarization

### Google Drive

- **Supported MIME types:** `application/vnd.google-apps.document` (Google Docs, exported as `text/plain`), `application/pdf` (exported as `text/plain` via Drive API), `text/plain`. Detection is by MIME type from the Drive API `files.list` response — not file extension.
- **Unsupported formats:** All other MIME types (images, spreadsheets, presentations, binaries) — logged as `[SKIP] {filename} — unsupported type ({mimeType})` and skipped
- **Text truncation:** 10,000 characters max before sending to Claude. The Claude prompt notes when content was truncated so it can produce an appropriately scoped summary.
- **Search:** Drive API `files.list` with `fullText contains` query built from `DRIVE_SEARCH_KEYWORDS`

### Gmail

- **Thread fetching:** Gmail API `threads.get` for each thread ID returned by search
- **Content extraction:** `text/plain` MIME parts only — no HTML parsing
- **Message ordering:** Oldest first, with sender name and date prepended to each message
- **Text truncation:** 10,000 characters max before sending to Claude
- **PII:** Raw email content never stored — only the Claude-generated summary reaches Supabase

### Summarizer Contract

```typescript
// Input
interface SummarizeInput {
  contentType: 'drive' | 'gmail';
  rawText: string;
  metadata: {
    filename?: string;   // Drive
    senders?: string[];  // Gmail
    dateRange?: string;  // Gmail
  };
}

// Output
interface SummarizeOutput {
  title: string;
  summary: string;
  category: KnowledgeCategory; // one of the valid enum values
  importance: 1 | 2 | 3 | 4 | 5;
}
```

Claude is instructed to return JSON with these four fields. Category must be one of: `open_thread`, `contact`, `vendor`, `decision`, `client`, `strategy`, `lesson`. Claude determines category and importance from content — no fragile keyword-mapping logic.

**Field length limits** (matching existing MCP validation):
- `title`: max 255 characters — truncated with `…` if Claude returns longer
- `summary` (stored as `content`): max 2,000 characters — truncated with `…` if Claude returns longer

**Model:** `claude-haiku-4-5-20251001` (fast, cheap, excellent at structured extraction)

---

## Security

- All env vars validated before any API call — exit on missing vars
- `.credentials/` and `.env` in `.gitignore`
- No raw email content, API keys, or tokens ever written to stdout or stderr
- Only `drive.readonly` and `gmail.readonly` Google scopes — no write access
- Supabase inserts use service role key server-side only
- All inputs validated before database writes (category enum, importance range, field lengths matching existing MCP validation)

---

## Error Handling

| Failure type | Behavior |
|---|---|
| Missing env var at startup | Exit immediately with named error |
| Google auth failure at startup | Exit immediately with clear message; re-auth if token expired |
| Drive file unreadable / unsupported MIME type | Log `[SKIP] {filename} — {reason}`, continue |
| Claude API failure (single item) | Retry once after 2s backoff; if still failing, log `[SKIP] {title} — Claude error`, continue |
| Claude rate limit (429) | Retry after 60s backoff; if still failing, log `[SKIP]` and continue |
| Supabase insert failure (single item) | Log `[SKIP] {title} — DB error: {message}`, continue |
| Auth failure mid-run (token revoked) | Log error to stderr, exit immediately — do not attempt further inserts |

**Partial sync safety:** Because inserts are individual and duplicate detection uses source URLs, a mid-run failure leaves the knowledge base in a valid partial state. Re-running the script picks up where it left off without creating duplicates.

Errors go to stderr. Progress output goes to stdout.

### Output Format

```
[Drive] Found 12 files matching search
[Drive] Synced: "Operations Guidebook 2025"
[Drive] Skipped (duplicate): "Vendor Contract — Erick Cordova"
[Gmail] Found 8 threads matching search
[Gmail] Synced: "Client onboarding — Joe Seckora"
---
Done. 3 Drive docs synced, 2 Gmail threads synced, 6 skipped.
```

---

## Testing

- Unit tests for `summarizer.ts` (mock Anthropic SDK), `brain.ts` (mock Supabase), `auth.ts` (mock token file I/O)
- Tests live in `scripts/lib/__tests__/`
- Integration tests omitted — OAuth 2.0 browser flow does not lend itself to CI
- Uses existing test runner in the project (Jest or Vitest, whichever is configured)

---

## Dependencies to Add

```json
{
  "googleapis": "already in rockwell-api — install fresh in rockwell-second-brain",
  "@anthropic-ai/sdk": "new",
  "dotenv": "likely already present"
}
```

Exact versions pinned at implementation time.

---

## Out of Scope

- Automatic/scheduled sync (cron) — on-demand only
- Google Sheets, Slides, or other non-text formats
- Email attachments
- Two-way sync (writing back to Drive/Gmail)
- Updating existing entries when source content changes (future: compare content hash)
