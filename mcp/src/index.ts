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

interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: true
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function err(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  }
}

// ─── Tool Handler (exported for testing) ─────────────────────────────────────

export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
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
      'Semantic + keyword hybrid search over the Rockwell Cortex knowledge base. ' +
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
      'Add a new knowledge entry to Rockwell Cortex. ' +
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handleTool(name, (args ?? {}) as Record<string, unknown>) as any
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
