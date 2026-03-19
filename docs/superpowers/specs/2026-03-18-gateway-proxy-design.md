---
title: Gateway Edge Function Proxy — Security & UI Redesign
date: 2026-03-18
status: approved
---

## Problem

The dashboard reads `knowledge_entries` directly from Supabase using the anon key.
RLS is enabled with no policies, so the anon key returns zero rows — 187 entries
are invisible. More critically, this architecture exposes the data access path to
anyone who can read the page source.

## Goals

- All database access flows through a single server-side Edge Function
- `SUPABASE_SERVICE_ROLE_KEY` and `DASHBOARD_SECRET` never appear in any committed file
- Anon key remains in the dashboard (safe — it can't reach the DB directly)
- Edit and delete operations added to the dashboard UI
- UI modernised: glassmorphism cards, inline edit/delete, cleaner layout

## Security Model

```
Browser (index.html)
  anon key → only used to invoke the gateway Edge Function
           → cannot touch the database (RLS ON, zero anon policies)

All requests → POST /functions/v1/gateway
  Authorization: Bearer {anon_key}
  X-Dashboard-Secret: {secret}        ← header on every request, no body exposure
  Body: { action, ...payload }
  │
  ▼
gateway/index.ts
  reads DASHBOARD_SECRET from Deno.env  ← Supabase secrets, never committed
  reads SUPABASE_SERVICE_ROLE_KEY from Deno.env
  reads SUPABASE_URL from Deno.env
  validates X-Dashboard-Secret → 401 if wrong, no DB call made
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) → bypasses RLS
```

| Secret | Location | In git? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets (CLI) | Never |
| `DASHBOARD_SECRET` | Supabase Edge Function secrets (CLI) | Never |
| `SUPABASE_URL` | Supabase Edge Function secrets (CLI) | Never |
| `SUPABASE_ANON_KEY` | `index.html` | Yes — safe, no DB access possible |

### localStorage Threat Model

The dashboard saves the secret to `localStorage` after first successful unlock so
the user doesn't re-enter it on every page load. `localStorage` is readable by any
script running on the same origin — an XSS vulnerability on the GitHub Pages domain
could exfiltrate it. Mitigations:

- No third-party scripts beyond Supabase JS CDN and timeago CDN (pinned versions)
- The secret controls only this personal dashboard — blast radius is contained
- If the secret is compromised: `supabase secrets set DASHBOARD_SECRET=<new>` and
  `supabase functions deploy gateway`; clear localStorage on the browser

`sessionStorage` is not used — it would require re-entry every browser session,
which degrades usability for a single-user personal tool. This trade-off is accepted.

## Gateway Edge Function

**File:** `supabase/functions/gateway/index.ts`

Replaces `add-entry` entirely. All requests are `POST`. Action is determined by the
`action` field in the JSON body.

| `action` | Operation | Required body fields |
|---|---|---|
| `list` | Return all entries, ordered by `created_at` desc | — |
| `add` | Insert new entry | `title`, `content`, `category`, `importance`, `tags`, `source` |
| `update` | Update entry by id | `id`, plus any subset of entry fields |
| `delete` | Delete entry by id | `id` |
| `search` | Hybrid semantic + keyword search via `search_knowledge` RPC | `query` |

**Validation on every request:**
1. Check `X-Dashboard-Secret` header === `DASHBOARD_SECRET` env var → `401` if wrong
2. For `update` and `delete`: check `id` present → `400` if missing
3. For `add`: check `title`, `content`, `category` present → `400` if missing
4. Parse request body as JSON → `400` if malformed

**HTTP error response table:**

| Status | When |
|---|---|
| 400 | Missing required fields, malformed JSON |
| 401 | Missing or incorrect `X-Dashboard-Secret` |
| 405 | Non-POST request method |
| 500 | DB error, service role key invalid, unexpected exception |
| 504 | `search_knowledge` RPC timeout (treated as 500 — Supabase Edge Functions don't distinguish) |

All errors return `{ "error": "<generic message>" }`. Full details logged server-side
via `console.error()` only — no internal info leaked to client.

**CORS:**
- `Access-Control-Allow-Origin: https://joselagunasjr-aislowlearner.github.io`
- Methods: `POST, OPTIONS`
- Headers: `Content-Type, Authorization, X-Dashboard-Secret`
- Local development: open the deployed URL directly in the browser or use the
  Supabase CLI `supabase functions serve` with a local `.env` file (excluded from git
  via `.gitignore`) containing the real secrets. No localhost CORS allowlist needed.

### `search_knowledge` RPC Signature (existing, defined in migration)

```sql
search_knowledge(
  query_embedding vector(768),  -- NULL when called from dashboard (no client embedding)
  query_text      text,
  match_count     int DEFAULT 10
)
RETURNS TABLE (id, title, content, category, tags, importance, source, created_at, rrf_score)
```

Gateway calls: `db.rpc('search_knowledge', { query_embedding: null, query_text: query, match_count: 20 })`

## Dashboard Changes

### Unlock Flow (page load)

```
Page loads
  │
  ├─ localStorage has 'dashboardSecret'?
  │     YES → loadEntries() immediately
  │     NO  → show unlock modal (centered, blocks content)
  │               User enters secret → clicks "Unlock"
  │               → POST gateway action:list with X-Dashboard-Secret header
  │               → 200: save to localStorage, hide modal, render entries
  │               → 401: show "Incorrect secret" inline, clear input, allow retry
  │                       (no retry limit — brute force is server-side rate-limited
  │                        implicitly by Supabase's Edge Function infra)
```

Status badge in header: 🔒 "Locked" (grey) → 🔓 "Unlocked" (green) after auth.

### JS Refactor

- Remove `window.supabase.createClient()` calls for data queries
- Keep anon key for `Authorization: Bearer` header on gateway calls
- All 5 operations use `callGateway(action, payload)` helper that:
  - Attaches `X-Dashboard-Secret` from in-memory variable (populated from localStorage or unlock modal)
  - POSTs to `ADD_ENTRY_FUNCTION_URL` (renamed to `GATEWAY_URL`)
  - Throws on non-2xx

### UI Redesign

**Cards:**
- Background: `rgba(255,255,255,0.03)` with `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(255,255,255,0.08)` + 3px left accent (category colour)
- Hover: lift (`translateY(-3px)`), border brightens, edit/delete buttons appear
- Edit ✏ and Delete 🗑 icon buttons — top-right, appear on hover via opacity transition
- Delete: clicking 🗑 replaces the two buttons with "Confirm?" + ✓ / ✗ inline — no `window.confirm()`

**Edit flow:**
- Clicking ✏ opens the existing side panel pre-filled with entry fields
- Submit calls `action: 'update'` — on success, updates the card in-place without full reload

**Other:**
- Sidebar stats: small category-coloured dot per stat row
- Search bar: pill shape, subtle glow on focus
- All transitions: `200ms ease-out`
- No external CSS frameworks added

## Deployment Checklist (safe rollout order)

1. `supabase secrets set DASHBOARD_SECRET=<value> SUPABASE_SERVICE_ROLE_KEY=<value> SUPABASE_URL=https://kihzwozrqcoqjkwvoxjg.supabase.co`
2. `supabase functions deploy gateway` — verify it returns 401 for a test curl with wrong secret
3. Update `index.html` locally, open `index.html` directly in browser pointing at deployed gateway — confirm entries load
4. `git push` → GitHub Pages redeploys — verify live site loads entries
5. `supabase functions delete add-entry` — only after live site is confirmed working
6. **Rollback**: `git revert HEAD` on the portal repo restores the old dashboard in ~1 min

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/gateway/index.ts` | New — replaces add-entry |
| `supabase/functions/add-entry/index.ts` | Deleted |
| `index.html` | JS rewrite + UI redesign |
| `.gitignore` | Add `*.env`, `.env*`, `supabase/.env`, `.env.local` |

## Secret Rotation

If `DASHBOARD_SECRET` is compromised:
```bash
supabase secrets set DASHBOARD_SECRET=<new-value>
supabase functions deploy gateway
# Clear localStorage in browser: localStorage.removeItem('dashboardSecret')
```
