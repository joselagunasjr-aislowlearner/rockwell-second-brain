import {
  Server,
  StdioServerTransport,
} from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================================
// Environment Variables & Client Initialization
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_EMBEDDING_API_KEY = process.env.GOOGLE_EMBEDDING_API_KEY;

// Validate environment variables at startup
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_EMBEDDING_API_KEY) {
  console.error(
    "Missing required environment variables. Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GOOGLE_EMBEDDING_API_KEY"
  );
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Initialize Google Generative AI client
const googleAI = new GoogleGenerativeAI(GOOGLE_EMBEDDING_API_KEY);

// ============================================================================
// Input Validation Functions
// ============================================================================

interface SearchBrainInput {
  query: string;
  limit?: number;
}

interface AddEntryInput {
  title: string;
  content: string;
  category: string;
  tags?: string[];
  importance?: number;
  source?: string;
}

interface ListEntriesInput {
  limit?: number;
  category?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateSearchBrainInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["Input must be an object"] };
  }

  const data = input as Record<string, unknown>;

  if (typeof data.query !== "string") {
    errors.push("query must be a string");
  } else if (data.query.length === 0) {
    errors.push("query cannot be empty");
  }

  let limit = 10; // default
  if (data.limit !== undefined) {
    if (typeof data.limit !== "number") {
      errors.push("limit must be a number");
    } else {
      limit = Math.max(1, Math.min(20, data.limit));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateAddEntryInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["Input must be an object"] };
  }

  const data = input as Record<string, unknown>;

  if (typeof data.title !== "string") {
    errors.push("title must be a string");
  } else if (data.title.length === 0) {
    errors.push("title cannot be empty");
  } else if (data.title.length > 500) {
    errors.push("title cannot exceed 500 characters");
  }

  if (typeof data.content !== "string") {
    errors.push("content must be a string");
  } else if (data.content.length === 0) {
    errors.push("content cannot be empty");
  } else if (data.content.length > 10000) {
    errors.push("content cannot exceed 10000 characters");
  }

  const validCategories = [
    "work",
    "personal",
    "health",
    "finance",
    "learning",
    "ideas",
    "projects",
    "other",
  ];
  if (typeof data.category !== "string") {
    errors.push("category must be a string");
  } else if (!validCategories.includes(data.category)) {
    errors.push(
      `category must be one of: ${validCategories.join(", ")}`
    );
  }

  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push("tags must be an array");
    } else if (data.tags.length > 20) {
      errors.push("tags cannot exceed 20 items");
    } else if (!data.tags.every((tag) => typeof tag === "string")) {
      errors.push("all tags must be strings");
    }
  }

  if (data.importance !== undefined) {
    if (typeof data.importance !== "number") {
      errors.push("importance must be a number");
    } else if (data.importance < 1 || data.importance > 5) {
      errors.push("importance must be between 1 and 5");
    }
  }

  if (data.source !== undefined && typeof data.source !== "string") {
    errors.push("source must be a string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateListEntriesInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["Input must be an object"] };
  }

  const data = input as Record<string, unknown>;

  if (data.limit !== undefined) {
    if (typeof data.limit !== "number") {
      errors.push("limit must be a number");
    } else if (data.limit < 1 || data.limit > 50) {
      errors.push("limit must be between 1 and 50");
    }
  }

  const validCategories = [
    "work",
    "personal",
    "health",
    "finance",
    "learning",
    "ideas",
    "projects",
    "other",
  ];
  if (
    data.category !== undefined &&
    typeof data.category === "string" &&
    !validCategories.includes(data.category)
  ) {
    errors.push(
      `category must be one of: ${validCategories.join(", ")}`
    );
  } else if (data.category !== undefined && typeof data.category !== "string") {
    errors.push("category must be a string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Embedding Generation
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  const model = googleAI.getGenerativeModel({
    model: "text-embedding-004",
  });

  const result = await model.embedContent(text);
  return result.embedding.values;
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleSearchBrain(input: unknown): Promise<string> {
  const validation = validateSearchBrainInput(input);
  if (!validation.valid) {
    console.error("Validation error:", validation.errors.join("; "));
    return JSON.stringify({
      error: `Invalid input: ${validation.errors.join("; ")}`,
    });
  }

  try {
    const data = input as Record<string, unknown>;
    const query = data.query as string;
    let limit = 10;
    if (typeof data.limit === "number") {
      limit = Math.max(1, Math.min(20, data.limit));
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Execute hybrid search RPC
    const { data: results, error } = await supabase.rpc("hybrid_search", {
      query_embedding: queryEmbedding,
      query_text: query,
      limit,
    });

    if (error) {
      console.error("Search error:", error);
      return JSON.stringify({ error: "Search failed", details: error.message });
    }

    // Add RRF scores and format results
    const formattedResults = (results || []).map((item: unknown, index: number) => {
      const entry = item as Record<string, unknown>;
      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        category: entry.category,
        tags: entry.tags || [],
        importance: entry.importance || 3,
        source: entry.source,
        created_at: entry.created_at,
        rrf_score: 1 / (60 + index),
      };
    });

    return JSON.stringify(formattedResults);
  } catch (error) {
    console.error("Search handler error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: "Search handler failed", details: errorMessage });
  }
}

async function handleAddEntry(input: unknown): Promise<string> {
  const validation = validateAddEntryInput(input);
  if (!validation.valid) {
    console.error("Validation error:", validation.errors.join("; "));
    return JSON.stringify({
      error: `Invalid input: ${validation.errors.join("; ")}`,
    });
  }

  try {
    const data = input as Record<string, unknown>;
    const title = data.title as string;
    const content = data.content as string;
    const category = data.category as string;
    const tags = (data.tags as string[]) || [];
    const importance = (data.importance as number) || 3;
    const source = (data.source as string) || null;

    // Generate embedding for the content
    const embedding = await generateEmbedding(content);

    // Insert into database
    const { data: result, error } = await supabase
      .from("brain_entries")
      .insert({
        title,
        content,
        category,
        tags,
        importance,
        source,
        embedding,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return JSON.stringify({ error: "Failed to add entry", details: error.message });
    }

    return JSON.stringify({
      id: result.id,
      created_at: result.created_at,
    });
  } catch (error) {
    console.error("Add entry handler error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      error: "Add entry handler failed",
      details: errorMessage,
    });
  }
}

async function handleListEntries(input: unknown): Promise<string> {
  const validation = validateListEntriesInput(input);
  if (!validation.valid) {
    console.error("Validation error:", validation.errors.join("; "));
    return JSON.stringify({
      error: `Invalid input: ${validation.errors.join("; ")}`,
    });
  }

  try {
    const data = input as Record<string, unknown>;
    let limit = 10;
    if (typeof data.limit === "number") {
      limit = Math.max(1, Math.min(50, data.limit));
    }
    const category = data.category as string | undefined;

    // Build query
    let query = supabase
      .from("brain_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    // Apply category filter if provided
    if (category) {
      query = query.eq("category", category);
    }

    const { data: results, error } = await query;

    if (error) {
      console.error("List error:", error);
      return JSON.stringify({ error: "Failed to list entries", details: error.message });
    }

    return JSON.stringify(results || []);
  } catch (error) {
    console.error("List entries handler error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      error: "List entries handler failed",
      details: errorMessage,
    });
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server({
  name: "rockwell-second-brain",
  version: "1.0.0",
});

// Define tools
const tools: Tool[] = [
  {
    name: "search_brain",
    description:
      "Search the Rockwell Second Brain using semantic and full-text search. Returns results ordered by relevance with RRF scores.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (1-20, default: 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "add_entry",
    description:
      "Add a new entry to the Rockwell Second Brain with semantic embedding for search.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Entry title (max 500 characters)",
        },
        content: {
          type: "string",
          description: "Entry content (max 10000 characters)",
        },
        category: {
          type: "string",
          description:
            'Category: work, personal, health, finance, learning, ideas, projects, or other',
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags (max 20 items)",
        },
        importance: {
          type: "number",
          description: "Importance level 1-5 (default: 3)",
        },
        source: {
          type: "string",
          description: "Optional source reference",
        },
      },
      required: ["title", "content", "category"],
    },
  },
  {
    name: "list_entries",
    description:
      "List entries from the Rockwell Second Brain, optionally filtered by category.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (1-50, default: 10)",
        },
        category: {
          type: "string",
          description:
            'Optional category filter: work, personal, health, finance, learning, ideas, projects, or other',
        },
      },
      required: [],
    },
  },
];

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const toolInput = request.params.arguments;

  let result: string;

  try {
    switch (toolName) {
      case "search_brain":
        result = await handleSearchBrain(toolInput);
        break;
      case "add_entry":
        result = await handleAddEntry(toolInput);
        break;
      case "list_entries":
        result = await handleListEntries(toolInput);
        break;
      default:
        result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    console.error(`Tool ${toolName} error:`, error);
    result = JSON.stringify({
      error: "Tool execution failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }

  const content: TextContent[] = [
    {
      type: "text",
      text: result,
    },
  ];

  return { content };
});

// ============================================================================
// Server Start
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rockwell Second Brain MCP server started");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
