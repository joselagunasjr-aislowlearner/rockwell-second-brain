# Rockwell Cortex — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Author:** Jose Lagunas

---

## Overview

A persistent knowledge base that lives outside any chat session. Stores decisions, contacts, lessons, open threads, vendors, clients, strategy notes, and daily notes for Rockwell Home Management. Supports keyword and semantic (vector) search. Accessible via a standalone dashboard on GitHub Pages and writable from Claude.ai via Supabase MCP.

---

## Goals

- Persist business context across Claude sessions
- Enable retrieval by meaning ("what did I decide about insurance?") not just keyword
- Pre-loaded with 20 seed entries from day one
- Simple dashboard for personal daily use — no client-facing elements
- New entries embeddable within 2 minutes of creation

---

## Architecture

```
Browser (index.html)
  └── Supabase JS client (anon key — read only)
  └── add-entry Edge Function (DASHBOARD_SECRET — writes)

Supabase
  ├── knowledge_entries (pgvector, tsvector)
  ├── embedding_queue (async job queue)
  ├── DB trigger (INSERT/UPDATE → enqueue)
  ├── process-embeddings Edge Function (cron every 2 min)
  └── add-entry Edge Function (HTTP, secret-gated)

Google Generative Language API
  └── text-embedding-004 (768-dim vectors)
```

---

## Database Schema

### `knowledge_entries`

```sql
CREATE TABLE knowledge_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  content      text NOT NULL,
  category     text NOT NULL CHECK (category IN (
                 'decision','contact','lesson','open_thread',
                 'vendor','client','strategy','daily_note')),
  tags         text[] NOT NULL DEFAULT '{}',
  importance   int NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source       text,
  embedding    vector(768),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

**Indexes:**
- `HNSW` on `embedding` using `vector_cosine_ops` (cosine distance, optimal for text embeddings at this scale)
- `GIN` on `to_tsvector('english', title || ' ' || content)` for full-text search
- B-tree on `category`, `importance`

### `embedding_queue`

```sql
CREATE TABLE embedding_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  attempt_count int NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);
```

**Index:** B-tree on `status` for efficient queue polling.

### Trigger

```sql
-- Auto-enqueue on insert or content change
CREATE OR REPLACE FUNCTION enqueue_embedding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO embedding_queue (entry_id)
  VALUES (NEW.id)
  ON CONFLICT (entry_id) WHERE status IN ('pending','processing')
  DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_embedding
AFTER INSERT OR UPDATE OF content ON knowledge_entries
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding();
```

### Hybrid Search RPC

```sql
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding vector(768),
  query_text      text,
  match_count     int DEFAULT 10
)
RETURNS TABLE (
  id uuid, title text, content text, category text,
  tags text[], importance int, source text,
  created_at timestamptz, rrf_score float
)
LANGUAGE sql AS $$
  WITH vector_results AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM knowledge_entries WHERE embedding IS NOT NULL
    LIMIT 50
  ),
  text_results AS (
    SELECT id, ROW_NUMBER() OVER (
      ORDER BY ts_rank(to_tsvector('english', title || ' ' || content),
               plainto_tsquery('english', query_text)) DESC
    ) AS rank
    FROM knowledge_entries
    WHERE to_tsvector('english', title || ' ' || content)
          @@ plainto_tsquery('english', query_text)
    LIMIT 50
  ),
  combined AS (
    SELECT COALESCE(v.id, t.id) AS id,
           COALESCE(1.0/(60 + v.rank), 0) + COALESCE(1.0/(60 + t.rank), 0) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT ke.id, ke.title, ke.content, ke.category, ke.tags,
         ke.importance, ke.source, ke.created_at, c.rrf_score
  FROM combined c
  JOIN knowledge_entries ke ON ke.id = c.id
  ORDER BY c.rrf_score DESC
  LIMIT match_count;
$$;
```

### Row Level Security

```sql
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
-- Anon can read all entries (dashboard uses anon key)
CREATE POLICY "anon_read" ON knowledge_entries
  FOR SELECT TO anon USING (true);
-- Only service role can write (add-entry Edge Function)
-- embedding_queue: service role only (no RLS policy = service role bypasses)
ALTER TABLE embedding_queue ENABLE ROW LEVEL SECURITY;
```

---

## Edge Function: `process-embeddings`

**Runtime:** Deno
**Trigger:** Supabase cron — `*/2 * * * *`
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_EMBEDDING_API_KEY`

**Algorithm:**
1. SELECT up to 10 rows from `embedding_queue` WHERE `status = 'pending'` AND `attempt_count < 3`, oldest first
2. Batch-update those rows to `status = 'processing'`
3. For each row:
   a. Fetch `title` + `content` from `knowledge_entries`
   b. Call `POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`
   c. Write returned 768-dim vector to `knowledge_entries.embedding`
   d. Mark queue row `done`, set `processed_at`
   e. On error: increment `attempt_count`, set status `pending` (retry) or `failed` (after 3 attempts)
4. 300ms delay between Google API calls

**Never logs:** entry content, credentials, or embedding vectors.

---

## Edge Function: `add-entry`

**Runtime:** Deno
**Trigger:** HTTP POST from dashboard
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_SECRET`

**Request body:**
```json
{
  "secret": "...",
  "title": "...",
  "content": "...",
  "category": "decision",
  "tags": ["tag1"],
  "importance": 4,
  "source": "..."
}
```

**Flow:**
1. Validate `secret` matches `DASHBOARD_SECRET` env var — reject with 401 if not
2. Insert row into `knowledge_entries` (trigger auto-enqueues embedding)
3. Return created entry `id` and `created_at`

CORS headers set to allow the GitHub Pages origin.

---

## Seed Data (20 entries)

| # | Title | Category | Importance |
|---|---|---|---|
| 1 | Marketing 360 renewal — May 15, 2026 deadline | open_thread | 5 |
| 2 | Marketing 360 contact: Christian Kellogg | contact | 4 |
| 3 | Potential replacement: Sarah Gordee at Hookd Promotions | open_thread | 4 |
| 4 | MSA finalization: Nicole Jessick / Schmoldt Law | open_thread | 5 |
| 5 | Insurance: "Safety Consulting Services" only — Tyler Sperry / Mower | decision | 5 |
| 6 | Client: Joe Seckora — Premier Management, Custos Hub prototype | client | 5 |
| 7 | Client: Lisa Seckora — portal access | client | 3 |
| 8 | Vendor: Erick Cordova / Cordova Cleaning LLC | vendor | 4 |
| 9 | Custos Hub trademark — USPTO Serial No. 99666509 | decision | 5 |
| 10 | Custos Hub Phase 1: general language only, no hardware specs | strategy | 5 |
| 11 | Revenue targets — 5-year plan to $5M net | strategy | 5 |
| 12 | Service tiers and pricing | strategy | 5 |
| 13 | Entry point: $150 Home Safety & Readiness Audit | strategy | 5 |
| 14 | ADRC referrals: same-day callback, no exceptions | decision | 5 |
| 15 | OPEN SECURITY FLAG: exposed API key needs confirmed rotation | open_thread | 5 |
| 16 | Playwright QA: 56 tests across 5 files — must stay green | lesson | 5 |
| 17 | Railway: no RLS — cross-tenant validation must be in NestJS guards | lesson | 5 |
| 18 | Railway: no SMTP — use Resend SDK for email | lesson | 4 |
| 19 | Compliance language rules | decision | 5 |
| 20 | Twin Cities expansion + DTC Custos Hub timeline | strategy | 4 |

---

## Dashboard (`index.html`)

**Hosting:** GitHub Pages, `joselagunasjr-aislowlearner.github.io/rockwell-second-brain/`
**Auth:** None for reads (anon key). Writes require `DASHBOARD_SECRET` entered once and stored in `localStorage`.

**Features:**
- Card grid, dark theme (`#0a0a0a` bg, `#141414` cards)
- Color-coded left border by category (8 colors)
- Category filter tabs + importance filter dropdown
- Keyword search (client-side, real-time)
- Semantic search (calls `search_knowledge` RPC, triggered on Enter)
- Expand card to full content
- Slide-in "New Entry" panel with all fields
- Importance shown as filled stars (★)

**Category colors:**
- decision → `#3b82f6` (blue)
- contact → `#22c55e` (green)
- lesson → `#f59e0b` (amber)
- open_thread → `#ef4444` (red)
- vendor → `#a855f7` (purple)
- client → `#06b6d4` (cyan)
- strategy → `#6366f1` (indigo)
- daily_note → `#6b7280` (gray)

---

## Deployment Sequence

1. Init git repo, push to GitHub as `rockwell-second-brain`, enable GitHub Pages (main, root)
2. Apply SQL migration via Supabase MCP (`apply_migration`)
3. Deploy Edge Functions via Supabase CLI
4. Set Edge Function secrets via `supabase secrets set`
5. Register cron job via Supabase Dashboard (pg_cron)
6. Run seed script: `deno run --allow-net scripts/seed.ts`
7. Invoke `process-embeddings` twice to drain 20-entry queue
8. Verify: all queue rows `done`, all entries have non-null `embedding`

---

## File Map

```
rockwell-second-brain/
├── docs/superpowers/specs/
│   └── 2026-03-16-second-brain-design.md
├── supabase/
│   ├── functions/
│   │   ├── process-embeddings/index.ts
│   │   └── add-entry/index.ts
│   └── migrations/
│       └── 20260316000000_create_second_brain.sql
├── scripts/
│   └── seed.ts
├── index.html
└── .gitignore
```

---

## Security Rules

- Service role key: server-side only (Edge Functions env vars, never in browser)
- Anon key: browser-safe, read-only via RLS
- `DASHBOARD_SECRET`: user-chosen string, stored in `localStorage`, sent in request body to `add-entry`
- No credentials in code, comments, logs, or committed files
- All write paths go through `add-entry` Edge Function — anon key cannot write
