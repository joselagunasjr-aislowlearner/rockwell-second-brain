# Rockwell Second Brain — MCP Server Design Spec

**Date:** 2026-03-17
**Status:** Approved
**Author:** Jose Lagunas

---

## Overview

A local MCP (Model Context Protocol) server that exposes the Rockwell Second Brain knowledge base to Claude Code and other MCP-compatible AI tools. The server runs as a STDIO process on the developer's machine, authenticates directly with Supabase using a service role key, and provides three tools: semantic search, add entry, and list recent entries.

---

## Goals

- Give Claude Code persistent read/write access to the Second Brain knowledge base
- Load automatically every Claude Code session via `~/.claude/settings.json`
- Never expose credentials in code or committed files
- Validate all inputs before touching the database
- Remain stable and simple as a long-term foundation

---

## Architecture

```
Claude Code
  └── STDIO
        └── node mcp/dist/index.js
              ├── search_brain  → Google Embedding API (text-embedding-004)
              │                 → Supabase search_knowledge RPC (hybrid vector + FTS)
              ├── add_entry     → Supabase REST (service role key)
              │                 → DB trigger auto-enqueues embedding
              └── list_entries  → Supabase REST (service role key)
```

**Transport:** STDIO (MCP standard for local tools)
**Runtime:** Node.js
**Language:** TypeScript, compiled to `dist/index.js`
**Database:** Existing Supabase project `kihzwozrqcoqjkwvoxjg`
**Embedding model:** Google `text-embedding-004` (768-dim) — same as the existing pipeline

---

## File Structure

```
rockwell-second-brain/
└── mcp/
    ├── src/
    │   └── index.ts          # all server logic
    ├── dist/
    │   └── index.js          # compiled output (gitignored)
    ├── package.json
    ├── tsconfig.json
    └── .env.example          # documents required vars, no real values
```

`dist/` is gitignored. No `.env` file — env vars are passed via Claude Code config.

---

## Environment Variables

All three are required. Server exits on startup if any are missing.

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://kihzwozrqcoqjkwvoxjg.supabase.co` | Safe to commit |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase Dashboard → Settings → API | Secret — never commit |
| `GOOGLE_EMBEDDING_API_KEY` | from Google AI Studio | Secret — never commit |

---

## Tools

### `search_brain`

**Purpose:** Semantic + keyword hybrid search over the knowledge base.

**Input schema:**
```typescript
{
  query: string,        // required — natural language search query
  limit?: number        // optional — max results (default: 10, max: 20)
}
```

**Flow:**
1. Validate inputs (query non-empty, limit clamped to 1–20)
2. Call Google Generative Language API to embed `query` using `text-embedding-004`
3. Call Supabase `search_knowledge` RPC with `query_embedding`, `query_text`, `match_count`
4. Return results ranked by RRF score

**Output:** Array of `{ id, title, content, category, tags, importance, source, created_at, rrf_score }`

**Error behavior:** Google API failure returns a clear error result. Server does not crash.

---

### `add_entry`

**Purpose:** Add a new knowledge entry to the Second Brain.

**Input schema:**
```typescript
{
  title: string,        // required — max 500 chars
  content: string,      // required — max 10,000 chars
  category: enum,       // required — one of: decision | contact | lesson | open_thread | vendor | client | strategy | daily_note
  tags?: string[],      // optional — max 20 items
  importance?: number,  // optional — integer 1–5 (default: 3)
  source?: string       // optional — origin of the information
}
```

**Flow:**
1. Validate all inputs before any DB call (enum check, length limits, importance range)
2. Insert into `knowledge_entries` using service role key
3. DB trigger automatically enqueues embedding (processed within 2 minutes by cron)
4. Return `{ id, created_at }`

**Output:** `{ id: string, created_at: string }`

---

### `list_entries`

**Purpose:** List recent knowledge entries, optionally filtered by category.

**Input schema:**
```typescript
{
  limit?: number,       // optional — max results (default: 10, max: 50)
  category?: enum       // optional — filter by category (same 8 values as add_entry)
}
```

**Flow:**
1. Validate inputs (limit clamped to 1–50, category must be valid enum if provided)
2. Query `knowledge_entries` ordered by `importance DESC, created_at DESC`
3. Apply category filter if provided

**Output:** Array of `{ id, title, content, category, tags, importance, source, created_at }`

---

## Security Model

- **Credential handling:** All secrets read from `process.env` at startup only. Never logged, never interpolated into strings that get logged.
- **Startup validation:** Server calls `process.exit(1)` immediately if any required env var is missing, with a clear message naming the missing var.
- **Input validation:** Enforced before any external call. Categories are validated against the known enum. String lengths are capped. Numeric ranges are enforced.
- **SQL injection:** Not possible — all DB access goes through the Supabase JS client with parameterized queries. No raw SQL construction.
- **Service role scope:** The service role key bypasses RLS, which is appropriate for a trusted local process. The server never exposes data over a network — it is STDIO only.
- **Error logging:** All errors go to `stderr`. `stdout` is reserved for the MCP protocol. Error messages contain descriptions, never credential values.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Missing env var at startup | Log name of missing var to stderr, exit(1) |
| Invalid tool input | Return MCP error result with descriptive message, no external call made |
| Google API failure (search_brain) | Return MCP error result with message, server stays alive |
| Supabase query failure | Return MCP error result with Supabase's error message |
| Unhandled exception | Caught at top level, logged to stderr, server stays alive |

---

## Claude Code Integration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "rockwell-second-brain": {
      "command": "node",
      "args": ["C:/Users/josel/rockwell-work/rockwell-second-brain/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://kihzwozrqcoqjkwvoxjg.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<your_service_role_key>",
        "GOOGLE_EMBEDDING_API_KEY": "<your_google_key>"
      }
    }
  }
}
```

The server starts automatically with every Claude Code session. No manual startup required.

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@supabase/supabase-js": "^2.38.4"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

No additional runtime dependencies. The MCP SDK handles STDIO transport. Supabase JS handles DB access and uses the built-in `fetch` available in Node 18+.

---

## Build & Run

```bash
cd mcp
npm install
npm run build        # tsc → dist/index.js
```

For development:
```bash
npm run dev          # npx tsx src/index.ts
```

---

## What Is NOT in Scope

- HTTP/SSE transport (can be added later without changing tool logic)
- Authentication beyond env var secrets (not needed for local STDIO)
- Update or delete tools (can be added later)
- Rate limiting (not needed for single-user local process)
