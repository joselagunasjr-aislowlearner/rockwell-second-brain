import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DASHBOARD_SECRET = Deno.env.get("DASHBOARD_SECRET");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DASHBOARD_SECRET) {
  throw new Error("Missing required environment variables");
}

const ALLOWED_ORIGIN = "https://joselagunasjr-aislowlearner.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Secret",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Validate secret — reject before any DB work
  const incoming = req.headers.get("X-Dashboard-Secret");
  if (!incoming || incoming !== DASHBOARD_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action } = body;
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    switch (action) {

      // ── LIST ──────────────────────────────────────────────────────────────
      case "list": {
        const { data, error } = await db
          .from("knowledge_entries")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json(data ?? []);
      }

      // ── ADD ───────────────────────────────────────────────────────────────
      case "add": {
        const { title, content, category, tags, importance, source } = body;
        if (!title || !content || !category) {
          return json({ error: "Missing required fields: title, content, category" }, 400);
        }
        const { data, error } = await db
          .from("knowledge_entries")
          .insert({
            title,
            content,
            category,
            tags: tags ?? [],
            importance: importance ?? 3,
            source: source ?? null,
          })
          .select("id, created_at")
          .single();
        if (error) throw error;
        return json(data, 201);
      }

      // ── UPDATE ────────────────────────────────────────────────────────────
      case "update": {
        const { id } = body;
        if (!id) return json({ error: "Missing required field: id" }, 400);
        const allowed = ["title", "content", "category", "tags", "importance", "source"];
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (key in body) patch[key] = body[key];
        }
        const { data, error } = await db
          .from("knowledge_entries")
          .update(patch)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return json(data);
      }

      // ── DELETE ────────────────────────────────────────────────────────────
      case "delete": {
        const { id } = body;
        if (!id) return json({ error: "Missing required field: id" }, 400);
        const { error } = await db
          .from("knowledge_entries")
          .delete()
          .eq("id", id);
        if (error) throw error;
        return json({ success: true });
      }

      // ── SEARCH ────────────────────────────────────────────────────────────
      case "search": {
        const { query } = body;
        if (!query) return json({ error: "Missing required field: query" }, 400);
        const { data, error } = await db.rpc("search_knowledge", {
          query_embedding: null,
          query_text: query,
          match_count: 20,
        });
        if (error) throw error;
        return json(data ?? []);
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(
      `[gateway] action=${String(action)} error:`,
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Internal server error" }, 500);
  }
});
