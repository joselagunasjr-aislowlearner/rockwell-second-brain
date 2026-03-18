# Rockwell Second Brain MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local STDIO MCP server in TypeScript that gives Claude Code read/write access to the Rockwell Second Brain knowledge base via three tools: `search_brain`, `add_entry`, and `list_entries`.

**Architecture:** Single `src/index.ts` file exporting pure validation functions (for testability) and registering three tool handlers with the MCP SDK. Supabase service role key for direct DB access. Google `text-embedding-004` for query embedding in semantic search. Compiled to `dist/index.js`, added to `~/.claude/settings.json`.

**Tech Stack:** TypeScript, Node.js 18+, `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, Jest + ts-jest

**Credentials needed at execution time:**
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Dashboard → Settings → API → service_role (secret)
- `GOOGLE_EMBEDDING_API_KEY`: Google AI Studio → Get API Key

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `mcp/package.json` | Create | Dependencies, scripts |
| `mcp/tsconfig.json` | Create | TypeScript compiler config |
| `mcp/.env.example` | Create | Documents required env vars |
| `mcp/src/index.ts` | Create | All server logic: startup validation, tool definitions, tool handlers, exported validation functions |
| `mcp/src/__tests__/index.test.ts` | Create | Jest tests for validation functions and tool rejection paths |
| `mcp/jest.config.js` | Create | Jest configuration |
| `.gitignore` | Modify | Add `mcp/dist/` and `mcp/node_modules/` |
| `~/.claude/settings.json` | Modify | Add MCP server config |

---

## Chunk 1: Project Scaffold

### Task 1: Create mcp/ directory and config files

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/jest.config.js`
- Create: `mcp/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create mcp/package.json**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\package.json`:

```json
{
  "name": "rockwell-second-brain-mcp",
  "version": "1.0.0",
  "description": "MCP server for the Rockwell Second Brain knowledge base",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "npx tsx src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@supabase/supabase-js": "^2.38.4"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create mcp/tsconfig.json**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/__tests__"]
}
```

- [ ] **Step 3: Create mcp/jest.config.js**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
```

- [ ] **Step 4: Create mcp/.env.example**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\.env.example`:

```
# Required — Supabase project URL (safe to share)
SUPABASE_URL=https://kihzwozrqcoqjkwvoxjg.supabase.co

# Required — Supabase service role key (SECRET — never commit)
# Found at: Supabase Dashboard → Settings → API → service_role
SUPABASE_SERVICE_ROLE_KEY=

# Required — Google AI API key for text-embedding-004 (SECRET — never commit)
# Found at: https://aistudio.google.com/app/apikey
GOOGLE_EMBEDDING_API_KEY=
```

- [ ] **Step 5: Update .gitignore**

Open `C:\Users\josel\rockwell-work\rockwell-second-brain\.gitignore` and add these lines:

```
mcp/dist/
mcp/node_modules/
```

- [ ] **Step 6: Create src directory and install dependencies**

```bash
mkdir -p /c/Users/josel/rockwell-work/rockwell-second-brain/mcp/src/__tests__
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit scaffold**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain
git add mcp/package.json mcp/tsconfig.json mcp/jest.config.js mcp/.env.example .gitignore
git commit -m "feat(mcp): scaffold mcp server project"
```

---

## Chunk 2: TDD — Tests + Implementation

### Task 2: Write failing tests

**Files:**
- Create: `mcp/src/__tests__/index.test.ts`

The tests cover:
1. Input validation rejection paths (no mocking needed — pure validation functions)
2. Tool handler happy paths (with mocked Supabase and fetch)

- [ ] **Step 1: Create mcp/src/__tests__/index.test.ts**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\src\__tests__\index.test.ts`:

```typescript
/**
 * Tests for Rockwell Second Brain MCP server.
 *
 * Strategy:
 * - Validation functions are exported from index.ts and tested directly (no mocking needed)
 * - Tool handler tests use jest.mock() to replace Supabase client and global fetch
 */

// Set env vars before any import
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.GOOGLE_EMBEDDING_API_KEY = 'test-google-key'

// Mock @supabase/supabase-js before import
const mockRpc = jest.fn()
const mockSingle = jest.fn()
const mockSelect = jest.fn()
const mockInsert = jest.fn()
const mockOrder = jest.fn()
const mockLimit = jest.fn()
const mockEq = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: mockRpc,
    from: jest.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
    })),
  })),
}))

// Mock @modelcontextprotocol/sdk to prevent STDIO side effects during tests
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}))
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}))

import {
  VALID_CATEGORIES,
  validateSearchArgs,
  validateAddEntryArgs,
  validateListArgs,
  handleTool,
} from '../index'

// ─── VALID_CATEGORIES ──────────────────────────────────────────────────────────

describe('VALID_CATEGORIES', () => {
  it('contains all 8 expected categories', () => {
    expect(VALID_CATEGORIES).toEqual(
      expect.arrayContaining([
        'decision', 'contact', 'lesson', 'open_thread',
        'vendor', 'client', 'strategy', 'daily_note',
      ])
    )
    expect(VALID_CATEGORIES).toHaveLength(8)
  })
})

// ─── validateSearchArgs ────────────────────────────────────────────────────────

describe('validateSearchArgs', () => {
  it('returns error when query is missing', () => {
    const result = validateSearchArgs({})
    expect(result).toEqual({ error: expect.stringContaining('query') })
  })

  it('returns error when query is empty string', () => {
    const result = validateSearchArgs({ query: '   ' })
    expect(result).toEqual({ error: expect.stringContaining('query') })
  })

  it('returns error when query exceeds 500 characters', () => {
    const result = validateSearchArgs({ query: 'a'.repeat(501) })
    expect(result).toEqual({ error: expect.stringContaining('500') })
  })

  it('returns defaults when only query is provided', () => {
    const result = validateSearchArgs({ query: 'insurance compliance' })
    expect(result).toEqual({ query: 'insurance compliance', limit: 10 })
  })

  it('clamps limit to maximum of 20', () => {
    const result = validateSearchArgs({ query: 'test', limit: 100 })
    expect(result).toEqual({ query: 'test', limit: 20 })
  })

  it('clamps limit to minimum of 1', () => {
    const result = validateSearchArgs({ query: 'test', limit: 0 })
    expect(result).toEqual({ query: 'test', limit: 1 })
  })
})

// ─── validateAddEntryArgs ──────────────────────────────────────────────────────

describe('validateAddEntryArgs', () => {
  const validArgs = {
    title: 'Test decision',
    content: 'Test content here',
    category: 'decision',
  }

  it('returns error when title is missing', () => {
    const result = validateAddEntryArgs({ ...validArgs, title: undefined })
    expect(result).toEqual({ error: expect.stringContaining('title') })
  })

  it('returns error when title exceeds 500 characters', () => {
    const result = validateAddEntryArgs({ ...validArgs, title: 'a'.repeat(501) })
    expect(result).toEqual({ error: expect.stringContaining('500') })
  })

  it('returns error when content is missing', () => {
    const result = validateAddEntryArgs({ ...validArgs, content: undefined })
    expect(result).toEqual({ error: expect.stringContaining('content') })
  })

  it('returns error when content exceeds 10000 characters', () => {
    const result = validateAddEntryArgs({ ...validArgs, content: 'a'.repeat(10001) })
    expect(result).toEqual({ error: expect.stringContaining('10,000') })
  })

  it('returns error when category is invalid', () => {
    const result = validateAddEntryArgs({ ...validArgs, category: 'invalid_category' })
    expect(result).toEqual({ error: expect.stringContaining('category') })
  })

  it('returns error when tags exceed 20 items', () => {
    const result = validateAddEntryArgs({ ...validArgs, tags: Array(21).fill('tag') })
    expect(result).toEqual({ error: expect.stringContaining('20') })
  })

  it('returns validated args with defaults on minimal valid input', () => {
    const result = validateAddEntryArgs(validArgs)
    expect(result).toMatchObject({
      title: 'Test decision',
      content: 'Test content here',
      category: 'decision',
      tags: [],
      importance: 3,
      source: null,
    })
  })

  it('clamps importance to range 1-5', () => {
    const result = validateAddEntryArgs({ ...validArgs, importance: 99 }) as Record<string, unknown>
    expect(result.importance).toBe(5)
  })

  it('accepts all 8 valid categories', () => {
    for (const category of VALID_CATEGORIES) {
      const result = validateAddEntryArgs({ ...validArgs, category })
      expect(result).not.toHaveProperty('error')
    }
  })
})

// ─── validateListArgs ──────────────────────────────────────────────────────────

describe('validateListArgs', () => {
  it('returns defaults when no args provided', () => {
    const result = validateListArgs({})
    expect(result).toEqual({ limit: 10, category: undefined })
  })

  it('clamps limit to maximum of 50', () => {
    const result = validateListArgs({ limit: 200 })
    expect(result).toEqual({ limit: 50, category: undefined })
  })

  it('returns error when category is invalid', () => {
    const result = validateListArgs({ category: 'not_a_real_category' })
    expect(result).toEqual({ error: expect.stringContaining('category') })
  })

  it('accepts valid category filter', () => {
    const result = validateListArgs({ category: 'strategy' })
    expect(result).toEqual({ limit: 10, category: 'strategy' })
  })
})

// ─── handleTool — search_brain ─────────────────────────────────────────────────

describe('handleTool: search_brain', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns error result for empty query', async () => {
    const result = await handleTool('search_brain', { query: '' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/query/)
  })

  it('returns error result when Google API fails', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'API key invalid',
    } as unknown as Response)

    const result = await handleTool('search_brain', { query: 'insurance compliance' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Error/)
  })

  it('returns results on success', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: { values: Array(768).fill(0.1) } }),
    } as unknown as Response)

    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'abc', title: 'Insurance policy', rrf_score: 0.05 }],
      error: null,
    })

    const result = await handleTool('search_brain', { query: 'insurance compliance' })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Insurance policy')
  })
})

// ─── handleTool — add_entry ────────────────────────────────────────────────────

describe('handleTool: add_entry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns error result for missing title', async () => {
    const result = await handleTool('add_entry', {
      content: 'Some content',
      category: 'decision',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/title/)
  })

  it('returns error result for invalid category', async () => {
    const result = await handleTool('add_entry', {
      title: 'Test',
      content: 'Content',
      category: 'bad_category',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/category/)
  })

  it('returns created entry on success', async () => {
    const mockChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValueOnce({
        data: { id: 'new-uuid', created_at: '2026-03-17T00:00:00Z' },
        error: null,
      }),
    }

    // Re-mock from() to return the chain
    const { createClient } = require('@supabase/supabase-js')
    createClient.mockReturnValue({ from: jest.fn(() => mockChain), rpc: mockRpc })

    // Re-import to pick up new mock (or use module reset)
    jest.resetModules()
    const { handleTool: freshHandleTool } = require('../index')

    const result = await freshHandleTool('add_entry', {
      title: 'New decision',
      content: 'We decided to do X',
      category: 'decision',
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('new-uuid')
  })
})

// ─── handleTool — list_entries ─────────────────────────────────────────────────

describe('handleTool: list_entries', () => {
  it('returns error result for invalid category filter', async () => {
    const result = await handleTool('list_entries', { category: 'invalid' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/category/)
  })

  it('returns error for unknown tool name', async () => {
    const result = await handleTool('unknown_tool', {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Unknown tool/)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail (module not found)**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
npm test
```

Expected: Tests fail with `Cannot find module '../index'`. This confirms the tests are wired correctly and waiting for implementation.

---

### Task 3: Implement src/index.ts

**Files:**
- Create: `mcp/src/index.ts`

- [ ] **Step 1: Create mcp/src/index.ts**

Create `C:\Users\josel\rockwell-work\rockwell-second-brain\mcp\src\index.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_CATEGORIES = [
  'decision',
  'contact',
  'lesson',
  'open_thread',
  'vendor',
  'client',
  'strategy',
  'daily_note',
] as const

type Category = (typeof VALID_CATEGORIES)[number]

// ─── Startup Validation ───────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_EMBEDDING_API_KEY',
] as const

const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length > 0) {
  process.stderr.write(
    `[rockwell-second-brain] Missing required env vars: ${missing.join(', ')}\n`
  )
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const GOOGLE_EMBEDDING_API_KEY = process.env.GOOGLE_EMBEDDING_API_KEY!

// ─── Supabase client ──────────────────────────────────────────────────────────

export let supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ─── Validation Functions (exported for testing) ──────────────────────────────

interface SearchArgs {
  query: string
  limit: number
}

interface AddEntryArgs {
  title: string
  content: string
  category: string
  tags: string[]
  importance: number
  source: string | null
}

interface ListArgs {
  limit: number
  category: string | undefined
}

type ValidationError = { error: string }

export function validateSearchArgs(args: Record<string, unknown>): SearchArgs | ValidationError {
  const query = args.query

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { error: 'query is required and must be a non-empty string' }
  }
  if (query.length > 500) {
    return { error: 'query must be 500 characters or fewer' }
  }

  const rawLimit = args.limit
  const limit = rawLimit !== undefined
    ? Math.min(Math.max(1, Number(rawLimit)), 20)
    : 10

  return { query: query.trim(), limit }
}

export function validateAddEntryArgs(args: Record<string, unknown>): AddEntryArgs | ValidationError {
  const title = args.title
  const content = args.content
  const category = args.category
  const tags = args.tags
  const importance = args.importance
  const source = args.source

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return { error: 'title is required and must be a non-empty string' }
  }
  if (title.length > 500) {
    return { error: 'title must be 500 characters or fewer' }
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { error: 'content is required and must be a non-empty string' }
  }
  if (content.length > 10000) {
    return { error: 'content must be 10,000 characters or fewer' }
  }
  if (!category || typeof category !== 'string') {
    return { error: `category is required. Must be one of: ${VALID_CATEGORIES.join(', ')}` }
  }
  if (!VALID_CATEGORIES.includes(category as Category)) {
    return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      return { error: 'tags must be an array of strings' }
    }
    if (tags.length > 20) {
      return { error: 'tags must have 20 items or fewer' }
    }
  }

  const clampedImportance =
    importance !== undefined
      ? Math.min(Math.max(1, Number(importance)), 5)
      : 3

  return {
    title: title.trim(),
    content: content.trim(),
    category,
    tags: Array.isArray(tags) ? tags : [],
    importance: clampedImportance,
    source: typeof source === 'string' ? source : null,
  }
}

export function validateListArgs(args: Record<string, unknown>): ListArgs | ValidationError {
  const rawLimit = args.limit
  const limit = rawLimit !== undefined
    ? Math.min(Math.max(1, Number(rawLimit)), 50)
    : 10

  const category = args.category
  if (category !== undefined && category !== null) {
    if (typeof category !== 'string' || !VALID_CATEGORIES.includes(category as Category)) {
      return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }
    }
    return { limit, category }
  }

  return { limit, category: undefined }
}

// ─── Embedding Helper ─────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GOOGLE_EMBEDDING_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: query }] },
      }),
    }
  )
  if (!res.ok) {
    throw new Error(`Google Embedding API error ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { embedding: { values: number[] } }
  return data.embedding.values
}

// ─── Tool Result Helpers ──────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  }
}

// ─── Tool Handler (exported for testing) ─────────────────────────────────────

export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<ReturnType<typeof ok> | ReturnType<typeof err>> {
  if (name === 'search_brain') {
    const validated = validateSearchArgs(args)
    if ('error' in validated) return err(validated.error)

    let embedding: number[]
    try {
      embedding = await embedQuery(validated.query)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`[search_brain] embed failed: ${message}\n`)
      return err(`Failed to embed query — ${message}`)
    }

    const { data, error } = await supabase.rpc('search_knowledge', {
      query_embedding: embedding,
      query_text: validated.query,
      match_count: validated.limit,
    })
    if (error) {
      process.stderr.write(`[search_brain] Supabase error: ${error.message}\n`)
      return err(error.message)
    }
    return ok(data)
  }

  if (name === 'add_entry') {
    const validated = validateAddEntryArgs(args)
    if ('error' in validated) return err(validated.error)

    const { data, error } = await supabase
      .from('knowledge_entries')
      .insert({
        title: validated.title,
        content: validated.content,
        category: validated.category,
        tags: validated.tags,
        importance: validated.importance,
        source: validated.source,
      })
      .select('id, created_at')
      .single()

    if (error) {
      process.stderr.write(`[add_entry] Supabase error: ${error.message}\n`)
      return err(error.message)
    }
    return ok(data)
  }

  if (name === 'list_entries') {
    const validated = validateListArgs(args)
    if ('error' in validated) return err(validated.error)

    let query = supabase
      .from('knowledge_entries')
      .select('id, title, content, category, tags, importance, source, created_at')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(validated.limit)

    if (validated.category) {
      query = query.eq('category', validated.category)
    }

    const { data, error } = await query
    if (error) {
      process.stderr.write(`[list_entries] Supabase error: ${error.message}\n`)
      return err(error.message)
    }
    return ok(data)
  }

  return err(`Unknown tool: ${name}`)
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'rockwell-second-brain', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

const TOOL_DEFINITIONS = [
  {
    name: 'search_brain',
    description:
      'Semantic + keyword hybrid search over the Rockwell Second Brain knowledge base. ' +
      'Finds entries by meaning, not just exact keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
          maxLength: 500,
        },
        limit: {
          type: 'integer',
          description: 'Max results to return (default: 10, max: 20)',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_entry',
    description:
      'Add a new knowledge entry to the Rockwell Second Brain. ' +
      'The entry will be automatically embedded within 2 minutes for semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Entry title', maxLength: 500 },
        content: { type: 'string', description: 'Entry content', maxLength: 10000 },
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description:
            'Entry category: decision | contact | lesson | open_thread | vendor | client | strategy | daily_note',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering (max 20)',
          maxItems: 20,
        },
        importance: {
          type: 'integer',
          description: 'Importance 1–5, where 5 is most critical (default: 3)',
          minimum: 1,
          maximum: 5,
        },
        source: {
          type: 'string',
          description: 'Source of the information (e.g. "client call", "legal", "architecture decision")',
        },
      },
      required: ['title', 'content', 'category'],
    },
  },
  {
    name: 'list_entries',
    description:
      'List recent knowledge entries ordered by importance (highest first), then by date. ' +
      'Optionally filter by category.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max results to return (default: 10, max: 50)',
          minimum: 1,
          maximum: 50,
        },
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description: 'Filter by category',
        },
      },
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  return handleTool(name, (args ?? {}) as Record<string, unknown>)
})

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[rockwell-second-brain] MCP server running\n')
}

main().catch((e) => {
  process.stderr.write(
    `[rockwell-second-brain] Fatal error: ${e instanceof Error ? e.message : String(e)}\n`
  )
  process.exit(1)
})
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
npm test
```

Expected output: All test suites pass. Example:
```
PASS src/__tests__/index.test.ts
  VALID_CATEGORIES
    ✓ contains all 8 expected categories
  validateSearchArgs
    ✓ returns error when query is missing
    ✓ returns error when query is empty string
    ...
Test Suites: 1 passed
Tests:       XX passed
```

If a test fails, fix `src/index.ts` before continuing. Do not proceed until all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain
git add mcp/src/
git commit -m "feat(mcp): implement MCP server with search_brain, add_entry, list_entries"
```

---

## Chunk 3: Build + Integration + Claude Code Config

### Task 4: Build and verify

**Files:**
- No new files — compiles `src/index.ts` → `dist/index.js`

- [ ] **Step 1: Build**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
npm run build
```

Expected: `dist/index.js` created with no TypeScript errors.

If there are TypeScript errors, fix them in `src/index.ts` before continuing.

- [ ] **Step 2: Smoke test — verify server starts and exits cleanly on missing env**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
node dist/index.js
```

Expected output to stderr (then exit code 1):
```
[rockwell-second-brain] Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_EMBEDDING_API_KEY
```

- [ ] **Step 3: Smoke test — verify server starts with env vars**

Replace `<service_role_key>` and `<google_key>` with real values (do not commit them):

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain/mcp
SUPABASE_URL=https://kihzwozrqcoqjkwvoxjg.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
GOOGLE_EMBEDDING_API_KEY=<google_key> \
node dist/index.js
```

Expected: Server prints to stderr and waits (does not exit):
```
[rockwell-second-brain] MCP server running
```

Press `Ctrl+C` to stop.

- [ ] **Step 4: Test with MCP inspector**

Install and run the MCP inspector to test all three tools interactively:

```bash
SUPABASE_URL=https://kihzwozrqcoqjkwvoxjg.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
GOOGLE_EMBEDDING_API_KEY=<google_key> \
npx @modelcontextprotocol/inspector node /c/Users/josel/rockwell-work/rockwell-second-brain/mcp/dist/index.js
```

This opens a browser UI at `http://localhost:5173`. Use it to:

- [ ] **Verify `list_entries`** — call with `{}`. Expected: JSON array of knowledge entries (up to 10).
- [ ] **Verify `search_brain`** — call with `{ "query": "insurance compliance" }`. Expected: ranked results including the insurance entry.
- [ ] **Verify `add_entry`** — call with:
  ```json
  {
    "title": "MCP server test entry",
    "content": "This entry was created during MCP server testing. Safe to delete.",
    "category": "lesson",
    "tags": ["mcp", "test"],
    "importance": 1
  }
  ```
  Expected: `{ "id": "<uuid>", "created_at": "<timestamp>" }`.

- [ ] **Verify `add_entry` validation** — call with `{ "title": "test", "content": "test", "category": "bad" }`.
  Expected: error response containing "category must be one of".

- [ ] **Commit build artifacts note**

`dist/` is gitignored. Only source is committed. This step has no commit.

---

### Task 5: Add to Claude Code settings

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Read current settings.json**

```bash
cat /c/Users/josel/.claude/settings.json
```

Note the current content. You will merge the MCP server entry into the existing JSON.

- [ ] **Step 2: Add MCP server config**

Open `C:\Users\josel\.claude\settings.json` and add the `rockwell-second-brain` entry inside `mcpServers`. If `mcpServers` doesn't exist, add it.

The entry to add (replace `<service_role_key>` and `<google_key>` with real values):

```json
"rockwell-second-brain": {
  "command": "node",
  "args": ["C:/Users/josel/rockwell-work/rockwell-second-brain/mcp/dist/index.js"],
  "env": {
    "SUPABASE_URL": "https://kihzwozrqcoqjkwvoxjg.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "<service_role_key>",
    "GOOGLE_EMBEDDING_API_KEY": "<google_key>"
  }
}
```

**Important:** Use forward slashes in the path (C:/Users/...), not backslashes.

- [ ] **Step 3: Verify settings.json is valid JSON**

```bash
node -e "require('/c/Users/josel/.claude/settings.json'); console.log('valid JSON')"
```

Expected: `valid JSON`. If you see a parse error, fix the JSON before continuing.

- [ ] **Step 4: Restart Claude Code and verify MCP server loads**

Restart Claude Code completely (close and reopen). Then in a new session, run:

```
/mcp
```

Expected: `rockwell-second-brain` appears in the list of connected MCP servers with status `connected`.

If it shows `failed`, check:
1. The path in `args` is correct and `dist/index.js` exists
2. The env vars are set correctly (no placeholder text)
3. Run `node C:/Users/josel/rockwell-work/rockwell-second-brain/mcp/dist/index.js` directly in a terminal to see the error

- [ ] **Step 5: Final commit**

```bash
cd /c/Users/josel/rockwell-work/rockwell-second-brain
git add mcp/
git commit -m "feat(mcp): add build output and finalize mcp server"
git push origin main
```

---

## Done

The MCP server is live. Claude Code will now have `search_brain`, `add_entry`, and `list_entries` available in every session automatically.

**Quick reference — tool usage examples:**

```
search_brain({ query: "what did we decide about insurance?" })
search_brain({ query: "ADRC referral process", limit: 5 })

add_entry({
  title: "Decision: use Resend for transactional email",
  content: "Switched from nodemailer to Resend SDK. Railway blocks SMTP.",
  category: "lesson",
  tags: ["railway", "email"],
  importance: 4
})

list_entries({ limit: 5, category: "open_thread" })
list_entries({})
```
