# Rockwell Second Brain Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent knowledge base with pgvector hybrid search, async embedding pipeline via Google text-embedding-004, 20 pre-seeded business entries, and a GitHub Pages dashboard for reading and writing entries.

**Architecture:** Supabase hosts all state — `knowledge_entries` (pgvector) and `embedding_queue`. Two Edge Functions: `process-embeddings` (cron, async) and `add-entry` (HTTP, secret-gated). Dashboard is a single `index.html` using Supabase JS (anon key) for reads and calling `add-entry` for writes. Semantic search calls Google Generative Language API from the browser to generate query embeddings, then calls Supabase `search_knowledge` RPC.

**Tech Stack:** Supabase (pgvector, pg_cron, pg_net, Edge Functions/Deno, Supabase JS v2), Google Generative Language API (text-embedding-004, 768-dim), GitHub Pages (vanilla HTML/CSS/JS), gh CLI, Supabase CLI

**Credentials needed at execution time:**
- `SUPABASE_URL`: `https://kihzwozrqcoqjkwvoxjg.supabase.co`
- `SUPABASE_ANON_KEY`: from Supabase Dashboard → Settings → API → anon (public)
- `SUPABASE_SERVICE_ROLE_KEY`: from Supabase Dashboard → Settings → API → service_role (secret)
- `GOOGLE_EMBEDDING_API_KEY`: from Google AI Studio → Get API Key
- `DASHBOARD_SECRET`: choose a passphrase (e.g. `rockwell2026`) — you'll enter this once in the dashboard

---

## Chunk 1: Repository Setup + Database Migration

### Task 1: Initialize repository

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\.gitignore`:

```
.env
.env.local
*.local
.DS_Store
node_modules/
supabase/.temp/
```

- [ ] **Step 2: Create GitHub repo**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain
gh repo create rockwell-second-brain --public --source=. --remote=origin --push
```

Expected: repo created at `https://github.com/joselagunasjr-aislowlearner/rockwell-second-brain`

- [ ] **Step 3: Enable GitHub Pages**

```bash
gh api repos/joselagunasjr-aislowlearner/rockwell-second-brain/pages \
  --method POST \
  -f source.branch=main \
  -f source.path=/
```

Expected: JSON response confirming Pages enabled.

- [ ] **Step 4: Commit and push**

```bash
git add .gitignore
git commit -m "chore: init repo with .gitignore"
git push origin main
```

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20260316000000_create_second_brain.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260316000000_create_second_brain.sql`:

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- knowledge_entries
CREATE TABLE knowledge_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  content     text        NOT NULL,
  category    text        NOT NULL CHECK (category IN (
                'decision','contact','lesson','open_thread',
                'vendor','client','strategy','daily_note')),
  tags        text[]      NOT NULL DEFAULT '{}',
  importance  int         NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source      text,
  embedding   vector(768),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- embedding_queue
CREATE TABLE embedding_queue (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      uuid        NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','done','failed')),
  attempt_count int         NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

-- Indexes
CREATE INDEX idx_ke_embedding  ON knowledge_entries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_ke_fts        ON knowledge_entries USING gin (to_tsvector('english', title || ' ' || content));
CREATE INDEX idx_ke_category   ON knowledge_entries (category);
CREATE INDEX idx_ke_importance ON knowledge_entries (importance);
CREATE INDEX idx_eq_status     ON embedding_queue (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ke_updated_at
BEFORE UPDATE ON knowledge_entries
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-enqueue on insert or content change
CREATE OR REPLACE FUNCTION enqueue_embedding()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO embedding_queue (entry_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ke_enqueue
AFTER INSERT OR UPDATE OF content ON knowledge_entries
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding();

-- Row Level Security
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_queue   ENABLE ROW LEVEL SECURITY;

-- Anon can read entries (dashboard uses anon key)
CREATE POLICY "anon_select" ON knowledge_entries
  FOR SELECT TO anon USING (true);

-- Hybrid search RPC (SECURITY DEFINER so anon can call it)
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding vector(768),
  query_text      text,
  match_count     int DEFAULT 10
)
RETURNS TABLE (
  id          uuid,
  title       text,
  content     text,
  category    text,
  tags        text[],
  importance  int,
  source      text,
  created_at  timestamptz,
  rrf_score   float
)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH vector_results AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM   knowledge_entries
    WHERE  embedding IS NOT NULL
    LIMIT  50
  ),
  text_results AS (
    SELECT id,
           ROW_NUMBER() OVER (
             ORDER BY ts_rank(
               to_tsvector('english', title || ' ' || content),
               plainto_tsquery('english', query_text)
             ) DESC
           ) AS rank
    FROM   knowledge_entries
    WHERE  to_tsvector('english', title || ' ' || content)
           @@ plainto_tsquery('english', query_text)
    LIMIT  50
  ),
  combined AS (
    SELECT COALESCE(v.id, t.id) AS id,
           COALESCE(1.0 / (60 + v.rank), 0.0) +
           COALESCE(1.0 / (60 + t.rank), 0.0) AS rrf_score
    FROM   vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT ke.id, ke.title, ke.content, ke.category, ke.tags,
         ke.importance, ke.source, ke.created_at, c.rrf_score
  FROM   combined c
  JOIN   knowledge_entries ke ON ke.id = c.id
  ORDER  BY c.rrf_score DESC
  LIMIT  match_count;
$$;

GRANT EXECUTE ON FUNCTION search_knowledge TO anon;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration`:
- project_id: `kihzwozrqcoqjkwvoxjg`
- name: `create_second_brain`
- query: (full SQL from Step 1)

- [ ] **Step 3: Verify tables exist**

Use `mcp__claude_ai_Supabase__list_tables` (project_id: `kihzwozrqcoqjkwvoxjg`, schema: `public`).

Expected: `knowledge_entries` and `embedding_queue` both present.

- [ ] **Step 4: Verify search function exists**

Use `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'search_knowledge';
```
Expected: 1 row returned.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add second brain schema — pgvector, hybrid search, RLS"
git push origin main
```

---

## Chunk 2: Edge Functions

### Task 3: process-embeddings Edge Function

**Files:**
- Create: `supabase/functions/process-embeddings/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/process-embeddings/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BATCH_SIZE = 10
const RATE_LIMIT_MS = 300

Deno.serve(async (_req) => {
  const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const googleApiKey    = Deno.env.get('GOOGLE_EMBEDDING_API_KEY')!

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Fetch pending items (oldest first, max 3 attempts)
  const { data: items, error: fetchErr } = await supabase
    .from('embedding_queue')
    .select('id, entry_id, attempt_count')
    .eq('status', 'pending')
    .lt('attempt_count', 3)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 })
  }
  if (!items || items.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: 'Queue empty' }), { status: 200 })
  }

  // Mark as processing (prevents double-processing on concurrent invocations)
  await supabase
    .from('embedding_queue')
    .update({ status: 'processing' })
    .in('id', items.map(i => i.id))

  let success = 0
  let failed  = 0

  for (const item of items) {
    const { data: entry, error: entryErr } = await supabase
      .from('knowledge_entries')
      .select('title, content')
      .eq('id', item.entry_id)
      .single()

    if (entryErr || !entry) {
      await supabase.from('embedding_queue').update({
        status: 'failed',
        error: entryErr?.message ?? 'Entry not found',
        processed_at: new Date().toISOString(),
      }).eq('id', item.id)
      failed++
      continue
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${googleApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text: `${entry.title}\n\n${entry.content}` }] },
          }),
        }
      )

      if (!res.ok) {
        throw new Error(`Google API ${res.status}: ${await res.text()}`)
      }

      const { embedding } = await res.json()

      await supabase
        .from('knowledge_entries')
        .update({ embedding: embedding.values })
        .eq('id', item.entry_id)

      await supabase.from('embedding_queue').update({
        status: 'done',
        processed_at: new Date().toISOString(),
      }).eq('id', item.id)

      success++
    } catch (err) {
      const attempts = item.attempt_count + 1
      await supabase.from('embedding_queue').update({
        status: attempts >= 3 ? 'failed' : 'pending',
        attempt_count: attempts,
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', item.id)
      failed++
    }

    // Rate limit: stay well within Google API quotas
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS))
  }

  return new Response(
    JSON.stringify({ processed: success, failed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
```

- [ ] **Step 2: Deploy via Supabase MCP**

Use `mcp__claude_ai_Supabase__deploy_edge_function`:
- project_id: `kihzwozrqcoqjkwvoxjg`
- name: `process-embeddings`
- entrypoint_path: (provide the full file content above)

- [ ] **Step 3: Set GOOGLE_EMBEDDING_API_KEY secret**

In Supabase Dashboard → Project `kihzwozrqcoqjkwvoxjg` → Edge Functions → Secrets → Add secret:
- Name: `GOOGLE_EMBEDDING_API_KEY`
- Value: (your Google AI Studio API key — starts with `AIzaSy`)

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — do NOT set them manually.

- [ ] **Step 4: Test invocation (empty queue — should return 200)**

```bash
curl -X POST \
  https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/process-embeddings \
  -H "Authorization: Bearer SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json"
```

Replace `SUPABASE_ANON_KEY` with the actual anon key from Supabase Dashboard.

Expected response: `{"processed":0,"message":"Queue empty"}`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-embeddings/
git commit -m "feat: add process-embeddings cron edge function"
git push origin main
```

---

### Task 4: add-entry Edge Function

**Files:**
- Create: `supabase/functions/add-entry/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/add-entry/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VALID_CATEGORIES = [
  'decision','contact','lesson','open_thread',
  'vendor','client','strategy','daily_note',
]

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin || 'https://joselagunasjr-aislowlearner.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const dashboardSecret = Deno.env.get('DASHBOARD_SECRET')!
  const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!body.secret || body.secret !== dashboardSecret) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { title, content, category, tags, importance, source } = body as {
    title?: string; content?: string; category?: string
    tags?: string[]; importance?: number; source?: string
  }

  if (!title || !content || !category) {
    return new Response(
      JSON.stringify({ error: 'title, content, and category are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return new Response(
      JSON.stringify({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data, error } = await supabase
    .from('knowledge_entries')
    .insert({
      title,
      content,
      category,
      tags:       tags ?? [],
      importance: importance ?? 3,
      source:     source ?? null,
    })
    .select('id, created_at')
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ id: data.id, created_at: data.created_at }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
```

- [ ] **Step 2: Deploy via Supabase MCP**

Use `mcp__claude_ai_Supabase__deploy_edge_function`:
- project_id: `kihzwozrqcoqjkwvoxjg`
- name: `add-entry`
- entrypoint_path: (provide the full file content above)

- [ ] **Step 3: Set DASHBOARD_SECRET**

In Supabase Dashboard → Edge Functions → Secrets → Add secret:
- Name: `DASHBOARD_SECRET`
- Value: (your chosen passphrase, e.g. `rockwell2026`)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/add-entry/
git commit -m "feat: add add-entry edge function with secret auth"
git push origin main
```

---

### Task 5: Register cron job

- [ ] **Step 1: Register the cron job via Supabase MCP**

Use `mcp__claude_ai_Supabase__execute_sql` (project_id: `kihzwozrqcoqjkwvoxjg`):

```sql
SELECT cron.schedule(
  'process-embeddings-every-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/process-embeddings',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'anon_key'
          LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

If the vault lookup fails (the anon key may not be in vault under that name), use this fallback — paste your anon key directly:

```sql
SELECT cron.schedule(
  'process-embeddings-every-2min',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/process-embeddings',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer SUPABASE_ANON_KEY_PLACEHOLDER"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
```

Replace `SUPABASE_ANON_KEY_PLACEHOLDER` with the actual anon key value before running.

- [ ] **Step 2: Verify cron job registered**

```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'process-embeddings-every-2min';
```

Expected: 1 row with schedule `*/2 * * * *`.

---

## Chunk 3: Seed Script + Queue Drain

### Task 6: Seed the database

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: Write seed.ts**

Create `scripts/seed.ts`:

```typescript
// Run: deno run --allow-net --allow-env scripts/seed.ts
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const headers = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Prefer':        'return=minimal',
}

const entries = [
  {
    title: 'Marketing 360 renewal — May 15, 2026 deadline',
    content: 'Marketing 360 contract renewal is due May 15, 2026. There is a 30-day cancellation notice requirement — the cancellation window opens April 15, 2026. Christian Kellogg is the contact at Marketing 360. Currently evaluating Sarah Gordee at Hookd Promotions as a potential replacement. Decision must be made before April 15.',
    category: 'open_thread',
    tags: ['marketing', 'vendor', 'deadline', 'contract'],
    importance: 5,
    source: 'business operations',
  },
  {
    title: 'Marketing 360 contact: Christian Kellogg',
    content: 'Christian Kellogg is the primary contact at Marketing 360. Handles contract renewals and service questions.',
    category: 'contact',
    tags: ['marketing', 'marketing360', 'vendor-contact'],
    importance: 4,
    source: 'business operations',
  },
  {
    title: 'Potential marketing replacement: Sarah Gordee at Hookd Promotions',
    content: 'Sarah Gordee at Hookd Promotions is being evaluated as a potential replacement for Marketing 360. Evaluation in progress ahead of the May 15, 2026 Marketing 360 renewal deadline.',
    category: 'open_thread',
    tags: ['marketing', 'hookd-promotions', 'vendor-eval'],
    importance: 4,
    source: 'business operations',
  },
  {
    title: 'MSA finalization: Nicole Jessick / Schmoldt Law',
    content: 'Master Service Agreement is being finalized with Nicole Jessick at Schmoldt Law. The MSA language must match the insurance coverage language exactly. Insurance through Tyler Sperry at Mower Insurance covers "Safety Consulting Services" only — MSA must reflect this.',
    category: 'open_thread',
    tags: ['legal', 'MSA', 'insurance', 'compliance'],
    importance: 5,
    source: 'legal',
  },
  {
    title: 'Insurance: "Safety Consulting Services" only — Tyler Sperry / Mower',
    content: 'Insurance is through Tyler Sperry at Mower Insurance. Policy covers "Safety Consulting Services" ONLY. Never describe services as "home inspection" or "property management" — these are NOT covered. All contracts, marketing, and communications must use compliant language. Non-negotiable.',
    category: 'decision',
    tags: ['insurance', 'compliance', 'legal', 'risk'],
    importance: 5,
    source: 'insurance policy',
  },
  {
    title: 'Client: Joe Seckora — Premier Management tier',
    content: 'Joe Seckora is the first active client on the Premier Management tier ($299/mo). His home is the live prototype site for the Custos Hub — real sensors, real monitoring. His wife Lisa Seckora also has portal access. Joe\'s account is the primary reference implementation for all future Premier and Estate client onboarding.',
    category: 'client',
    tags: ['client', 'premier', 'custos-hub', 'prototype', 'seckora'],
    importance: 5,
    source: 'client records',
  },
  {
    title: 'Client: Lisa Seckora — portal access',
    content: 'Lisa Seckora is the wife of Joe Seckora. She has household portal access linked to Joe\'s home profile.',
    category: 'client',
    tags: ['client', 'household-member', 'seckora'],
    importance: 3,
    source: 'client records',
  },
  {
    title: 'Vendor: Erick Cordova / Cordova Cleaning LLC',
    content: 'Erick Cordova at Cordova Cleaning LLC is an active vendor partner. Engaged for cleaning services as part of the Rockwell Home Management service delivery network.',
    category: 'vendor',
    tags: ['vendor', 'cleaning', 'cordova'],
    importance: 4,
    source: 'vendor records',
  },
  {
    title: 'Custos Hub trademark — USPTO Serial No. 99666509',
    content: '"Custos Hub" is a registered trademark. USPTO Serial No. 99666509. Protect this brand in all public communications. Do not allow third parties to use this name without authorization.',
    category: 'decision',
    tags: ['trademark', 'custos-hub', 'legal', 'IP'],
    importance: 5,
    source: 'USPTO filing',
  },
  {
    title: 'Custos Hub Phase 1: general language only, no hardware specs',
    content: 'During Phase 1, all public-facing communication about the Custos Hub must use general language only. Do NOT disclose hardware specifications, sensor counts, sensor types, or technical implementation details. These are reserved for Phase 2. Applies to website copy, sales conversations, and marketing materials.',
    category: 'strategy',
    tags: ['custos-hub', 'product', 'marketing', 'phase1'],
    importance: 5,
    source: 'product strategy',
  },
  {
    title: 'Revenue targets — 5-year plan to $5M net',
    content: 'Year 1: $80,000. Year 2: $250,000. Year 3: $600,000. Year 4: $1,500,000. Year 5: $2,570,000+. Cumulative 5-year goal: $5,000,000 net. These targets inform hiring, technology investment, and expansion timing decisions.',
    category: 'strategy',
    tags: ['revenue', 'targets', 'growth', 'financial'],
    importance: 5,
    source: 'business plan',
  },
  {
    title: 'Service tiers and pricing',
    content: 'Three service tiers: Essential Watch at $129/month, Premier Management at $299/month, Estate Concierge at $749/month. Always upsell toward Estate Concierge — best margin and highest client retention. Entry point is the $150 Home Safety & Readiness Audit.',
    category: 'strategy',
    tags: ['pricing', 'tiers', 'essential-watch', 'premier-management', 'estate-concierge'],
    importance: 5,
    source: 'business model',
  },
  {
    title: 'Entry point: $150 Home Safety & Readiness Audit',
    content: 'The $150 Home Safety & Readiness Audit is the primary entry point for all new clients. Always call it the "Home Safety & Readiness Audit" — never a "home inspection." This audit is both a revenue generator and a sales tool that converts into subscription tiers.',
    category: 'strategy',
    tags: ['audit', 'sales', 'entry-point', 'compliance'],
    importance: 5,
    source: 'business model',
  },
  {
    title: 'ADRC referrals: same-day callback, Priority 1',
    content: 'Any referral from an Area Agency on Aging / ADRC (Aging and Disability Resource Center) is Priority 1. Same-day callback required — no exceptions. Missing an ADRC callback window is unacceptable. These referrals represent the highest-value pipeline for the Elder Care market segment.',
    category: 'decision',
    tags: ['ADRC', 'referrals', 'elder-care', 'priority'],
    importance: 5,
    source: 'operations policy',
  },
  {
    title: 'OPEN SECURITY FLAG: exposed API key needs confirmed rotation',
    content: 'A previously exposed API key was found on GitHub and has not been confirmed as rotated. Action required: identify the key, confirm rotation in all affected services, document resolution here. Until closed, assume potential unauthorized access to whatever that key controlled.',
    category: 'open_thread',
    tags: ['security', 'api-key', 'incident', 'urgent'],
    importance: 5,
    source: 'security audit',
  },
  {
    title: 'Playwright QA: 56 tests across 5 files — must stay green',
    content: 'Playwright QA suite: 01-login-page.spec.ts, 02-login-otp-flow.spec.ts, 03-post-login-dashboard.spec.ts, 04-session-expiry.spec.ts, 05-logout-back-button.spec.ts. Must stay green before onboarding any new client. Critical: serviceWorkers: "block" required — prevents SW from intercepting test mocks. Location: rockwell-member-portal/tests/',
    category: 'lesson',
    tags: ['playwright', 'testing', 'QA', 'portal'],
    importance: 5,
    source: 'engineering standards',
  },
  {
    title: 'Railway: no RLS — cross-tenant validation must be in NestJS guards',
    content: 'Railway does not support Supabase Row Level Security in the NestJS API context. All cross-tenant validation must be implemented in NestJS guards — never rely on Supabase RLS for data isolation in the Railway-hosted API.',
    category: 'lesson',
    tags: ['railway', 'RLS', 'nestjs', 'security', 'architecture'],
    importance: 5,
    source: 'architecture decision',
  },
  {
    title: 'Railway: no SMTP — use Resend SDK for email',
    content: 'Railway blocks outbound SMTP. All email sending must use the Resend SDK — not nodemailer or any direct SMTP approach. Hard platform constraint, not a preference.',
    category: 'lesson',
    tags: ['railway', 'email', 'resend', 'SMTP'],
    importance: 4,
    source: 'architecture decision',
  },
  {
    title: 'Compliance language rules',
    content: 'Required substitutions in all communications: "activity awareness" not "monitoring". "Safety consultation" not "inspection". "Older adults" not "elderly". Always call the entry service "Home Safety & Readiness Audit" — never "home inspection". Applies to website copy, contracts, sales calls, and all written or verbal communications.',
    category: 'decision',
    tags: ['compliance', 'language', 'legal', 'brand'],
    importance: 5,
    source: 'legal / brand guidelines',
  },
  {
    title: 'Twin Cities expansion + DTC Custos Hub timeline',
    content: 'Twin Cities regional expansion begins no later than Year 3. DTC Custos Hub Home Edition launches Month 12-18 at $299-$499 hardware kit plus $19.99-$39.99/month subscription. Runs parallel to the managed service business and opens a scalable, lower-touch revenue stream.',
    category: 'strategy',
    tags: ['expansion', 'custos-hub', 'DTC', 'twin-cities', 'timeline'],
    importance: 4,
    source: 'business plan',
  },
]

async function seed() {
  console.log(`Seeding ${entries.length} knowledge entries...`)
  let inserted = 0
  let skipped  = 0

  for (const entry of entries) {
    // Idempotency: skip if title already exists
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_entries?title=eq.${encodeURIComponent(entry.title)}&select=id`,
      { headers }
    )
    const existing: unknown[] = await checkRes.json()
    if (existing.length > 0) {
      console.log(`  SKIP: "${entry.title}"`)
      skipped++
      continue
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
    })

    if (res.status === 201) {
      console.log(`  OK:   "${entry.title}"`)
      inserted++
    } else {
      console.error(`  ERR:  "${entry.title}" — ${res.status}: ${await res.text()}`)
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`)
  console.log('Embedding queue will be processed on next cron run (within 2 minutes).')
}

seed().catch(console.error)
```

- [ ] **Step 2: Run the seed script**

```bash
export SUPABASE_URL=https://kihzwozrqcoqjkwvoxjg.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
cd /c/Users/josel/rockwell-work/rockwell-second-brain
deno run --allow-net --allow-env scripts/seed.ts
```

Expected output: 20 lines starting with `OK:`, ending with `Inserted: 20, Skipped: 0`.

- [ ] **Step 3: Verify queue populated**

Use `mcp__claude_ai_Supabase__execute_sql` (project_id: `kihzwozrqcoqjkwvoxjg`):

```sql
SELECT status, COUNT(*) FROM embedding_queue GROUP BY status;
```

Expected: one row — `pending | 20`

- [ ] **Step 4: Drain queue — first invocation (entries 1-10)**

```bash
curl -X POST \
  https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/process-embeddings \
  -H "Authorization: Bearer SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json"
```

Expected: `{"processed":10,"failed":0}`

- [ ] **Step 5: Drain queue — second invocation (entries 11-20)**

```bash
curl -X POST \
  https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/process-embeddings \
  -H "Authorization: Bearer SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json"
```

Expected: `{"processed":10,"failed":0}`

- [ ] **Step 6: Verify all embeddings generated**

```sql
SELECT
  COUNT(*)              AS total,
  COUNT(embedding)      AS with_embedding,
  COUNT(*) - COUNT(embedding) AS missing
FROM knowledge_entries;
```

Expected: `total=20, with_embedding=20, missing=0`

```sql
SELECT status, COUNT(*) FROM embedding_queue GROUP BY status;
```

Expected: `done | 20`

- [ ] **Step 7: Commit seed script**

```bash
git add scripts/
git commit -m "feat: add seed script with 20 business knowledge entries"
git push origin main
```

---

## Chunk 4: Dashboard + GitHub Pages

### Task 7: Build the dashboard

**Files:**
- Create: `index.html`

**Invoke the `frontend-design` skill** for this task to ensure production-grade visual quality.

The dashboard must meet these requirements precisely:

**Supabase config (embed in HTML — anon key is browser-safe):**
```javascript
const SUPABASE_URL      = 'https://kihzwozrqcoqjkwvoxjg.supabase.co'
const SUPABASE_ANON_KEY = '<SUPABASE_ANON_KEY>'   // from Supabase Dashboard → Settings → API
const GOOGLE_KEY        = '<GOOGLE_EMBEDDING_API_KEY>'  // for client-side query embedding
const ADD_ENTRY_URL     = 'https://kihzwozrqcoqjkwvoxjg.supabase.co/functions/v1/add-entry'
```

**Dark theme:**
- Background: `#0a0a0a`
- Card background: `#141414`
- Card border: `#1f1f1f`
- Primary text: `#e5e7eb`
- Secondary text: `#9ca3af`
- Accent: `#6366f1`

**Category left-border colors:**
```javascript
const CATEGORY_COLORS = {
  decision:   '#3b82f6',  // blue
  contact:    '#22c55e',  // green
  lesson:     '#f59e0b',  // amber
  open_thread:'#ef4444',  // red
  vendor:     '#a855f7',  // purple
  client:     '#06b6d4',  // cyan
  strategy:   '#6366f1',  // indigo
  daily_note: '#6b7280',  // gray
}
```

**Data loading:**
```javascript
const supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const { data: allEntries } = await supabase
  .from('knowledge_entries')
  .select('*')
  .order('importance', { ascending: false })
  .order('created_at', { ascending: false })
```

**Keyword search (real-time, client-side):**
```javascript
function filterEntries(entries, searchText, category, minImportance) {
  return entries.filter(e => {
    const text = searchText.toLowerCase()
    const matchesText = !text ||
      e.title.toLowerCase().includes(text) ||
      e.content.toLowerCase().includes(text) ||
      e.tags.some(t => t.toLowerCase().includes(text))
    const matchesCat = !category || e.category === category
    const matchesImp = !minImportance || e.importance >= minImportance
    return matchesText && matchesCat && matchesImp
  })
}
```

**Semantic search (on Enter or button click):**
```javascript
async function semanticSearch(query) {
  // Step 1: generate query embedding via Google API
  const embRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GOOGLE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: query }] },
      }),
    }
  )
  const { embedding } = await embRes.json()

  // Step 2: call hybrid search RPC
  const { data } = await supabase.rpc('search_knowledge', {
    query_embedding: embedding.values,
    query_text: query,
    match_count: 20,
  })
  return data
}
```

**Add entry (slide-in panel):**
- Prompts for `DASHBOARD_SECRET` once on first write, stores in `localStorage` as `rsb_secret`
- Fields: Title (text), Category (dropdown), Content (textarea, 5 rows), Tags (comma-separated text → split to array), Importance (1-5 star selector), Source (text)
- On submit:
```javascript
const res = await fetch(ADD_ENTRY_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    secret: localStorage.getItem('rsb_secret'),
    title, content, category,
    tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
    importance: parseInt(importanceValue),
    source,
  }),
})
if (res.status === 201) {
  // reload entries, close panel, show success toast
}
if (res.status === 401) {
  // clear stored secret, prompt again
  localStorage.removeItem('rsb_secret')
}
```

**Card design:**
- 4px solid left border in category color
- Category badge (text, small, same color as border)
- Importance: `★`.repeat(importance) + `☆`.repeat(5-importance) in gold
- Title: 1.1rem, semi-bold
- Content preview: 3 lines, clamped with `-webkit-line-clamp: 3`
- Tags: small gray chips below content
- "Expand" button: toggles full content visibility
- Updated_at: small secondary text, relative time (e.g. "2 days ago")

**Layout:**
- Header: "ROCKWELL SECOND BRAIN" left, "+ New Entry" button right
- Search bar row: text input (flex-grow) + "Semantic" button
- Filter row: category tabs (All + 8 categories) + importance dropdown
- Card grid: 2 columns on desktop, 1 on mobile (CSS grid, `repeat(auto-fill, minmax(380px, 1fr))`)
- "New Entry" panel: slides in from right, overlay backdrop

- [ ] **Step 1: Implement index.html using frontend-design skill**

Invoke `frontend-design` skill with all requirements above and produce the complete `index.html`.

- [ ] **Step 2: Insert actual credential values**

In the generated `index.html`, replace the placeholders:
- `<SUPABASE_ANON_KEY>` → actual anon key
- `<GOOGLE_EMBEDDING_API_KEY>` → actual Google API key

These are browser-safe values. The anon key is read-only per RLS. The Google key is only used to generate query embeddings for semantic search.

- [ ] **Step 3: Create .nojekyll**

```bash
touch /c/Users/josel/rockwell-work/rockwell-second-brain/.nojekyll
```

This prevents GitHub Pages from processing the site through Jekyll.

- [ ] **Step 4: Commit and push**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain
git add index.html .nojekyll
git commit -m "feat: add Second Brain dashboard"
git push origin main
```

- [ ] **Step 5: Verify GitHub Pages is live**

Wait ~60 seconds for Pages to deploy, then:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://joselagunasjr-aislowlearner.github.io/rockwell-second-brain/
```

Expected: `200`

- [ ] **Step 6: Smoke test — load dashboard and verify 20 entries appear**

Open `https://joselagunasjr-aislowlearner.github.io/rockwell-second-brain/` in browser.

Verify:
- [ ] 20 cards load with correct categories and colors
- [ ] Category filter works (click "Strategy" → only strategy cards shown)
- [ ] Keyword search works (type "ADRC" → ADRC card appears)
- [ ] Expand button shows full content
- [ ] Semantic search returns relevant results for query "insurance compliance"
- [ ] "+ New Entry" panel opens, prompts for secret, submits a test entry, entry appears

---

## Done

Dashboard URL: `https://joselagunasjr-aislowlearner.github.io/rockwell-second-brain/`

Reminder: In Claude.ai chat sessions, you can say **"log this as a [category] entry"** and it will write directly to this database via the Supabase MCP that's connected there.
