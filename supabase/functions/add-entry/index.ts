import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DASHBOARD_SECRET = Deno.env.get("DASHBOARD_SECRET");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DASHBOARD_SECRET) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface AddEntryRequest {
  secret: string;
  title: string;
  content: string;
  category: string;
  tags?: string[];
  importance?: number;
  source?: string;
}

interface AddEntryResponse {
  id: string;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
      },
    });
  }

  try {
    const body = (await req.json()) as AddEntryRequest;

    // Validate secret
    if (body.secret !== DASHBOARD_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
        },
      });
    }

    // Validate required fields
    if (!body.title || !body.content || !body.category) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, content, category" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
          },
        }
      );
    }

    // Insert into knowledge_entries (trigger will auto-enqueue)
    const { data, error } = await supabase
      .from("knowledge_entries")
      .insert({
        title: body.title,
        content: body.content,
        category: body.category,
        tags: body.tags || [],
        importance: body.importance || 3,
        source: body.source || null,
      })
      .select("id, created_at")
      .single();

    if (error || !data) {
      console.error("Error inserting entry:", error?.message);
      return new Response(JSON.stringify({ error: "Failed to create entry" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
        },
      });
    }

    const response: AddEntryResponse = {
      id: data.id,
      created_at: data.created_at,
    };

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
      },
    });
  } catch (error) {
    console.error("Error in add-entry function:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://joselagunasjr-aislowlearner.github.io",
      },
    });
  }
});
