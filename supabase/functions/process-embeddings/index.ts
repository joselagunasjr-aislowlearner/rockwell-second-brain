import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_EMBEDDING_API_KEY = Deno.env.get("GOOGLE_EMBEDDING_API_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_EMBEDDING_API_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface QueueRow {
  id: string;
  entry_id: string;
}

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
}

interface GoogleEmbeddingResponse {
  embedding: {
    values: number[];
  };
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GOOGLE_EMBEDDING_API_KEY,
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-2-preview",
        content: {
          parts: [
            {
              text: text,
            },
          ],
        },
        outputDimensionality: 768,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`);
  }

  const data = (await response.json()) as GoogleEmbeddingResponse;
  return data.embedding.values;
}

async function processQueue(): Promise<{ processed: number; failed: number } | { processed: number; message: string }> {
  try {
    // Fetch up to 10 pending entries, oldest first
    const { data: pendingQueue, error: fetchError } = await supabase
      .from("embedding_queue")
      .select("id, entry_id")
      .eq("status", "pending")
      .lt("attempt_count", 3)
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error("Error fetching queue:", fetchError.message);
      return { processed: 0, failed: 0 };
    }

    if (!pendingQueue || pendingQueue.length === 0) {
      console.log("No pending embeddings to process");
      return { processed: 0, message: "Queue empty" };
    }

    const queueIds = (pendingQueue as QueueRow[]).map((row) => row.id);

    // Batch-update to processing status
    const { error: updateError } = await supabase
      .from("embedding_queue")
      .update({ status: "processing" })
      .in("id", queueIds);

    if (updateError) {
      console.error("Error updating queue status:", updateError.message);
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    // Process each entry
    for (const queueRow of pendingQueue as QueueRow[]) {
      await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms delay

      try {
        // Fetch the entry
        const { data: entry, error: entryError } = await supabase
          .from("knowledge_entries")
          .select("id, title, content")
          .eq("id", queueRow.entry_id)
          .single();

        if (entryError || !entry) {
          throw new Error("Entry not found");
        }

        const knowledgeEntry = entry as KnowledgeEntry;

        // Get embedding from Google API
        const text = `${knowledgeEntry.title} ${knowledgeEntry.content}`;
        const embedding = await getEmbedding(text);

        // Update knowledge_entries with embedding
        const { error: embedError } = await supabase
          .from("knowledge_entries")
          .update({ embedding })
          .eq("id", knowledgeEntry.id);

        if (embedError) {
          throw embedError;
        }

        // Mark queue entry as done
        const { error: doneError } = await supabase
          .from("embedding_queue")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", queueRow.id);

        if (doneError) {
          throw doneError;
        }

        processed++;
        console.log(`Processed embedding for entry ${knowledgeEntry.id}`);
      } catch (error) {
        console.error(
          `Error processing entry ${queueRow.entry_id}:`,
          error instanceof Error ? error.message : String(error)
        );

        // Increment attempt count and decide retry vs failure
        const { data: currentQueue } = await supabase
          .from("embedding_queue")
          .select("attempt_count")
          .eq("id", queueRow.id)
          .single();

        const newAttemptCount = ((currentQueue as { attempt_count: number })
          ?.attempt_count ?? 0) + 1;
        const newStatus = newAttemptCount >= 3 ? "failed" : "pending";
        const errorMsg =
          error instanceof Error ? error.message : String(error);

        const { error: updateQueueError } = await supabase
          .from("embedding_queue")
          .update({
            status: newStatus,
            attempt_count: newAttemptCount,
            error: errorMsg,
          })
          .eq("id", queueRow.id);

        if (updateQueueError) {
          console.error(
            "Error updating queue after failure:",
            updateQueueError.message
          );
        }
        failed++;
      }
    }

    console.log("Queue processing completed");
    return { processed, failed };
  } catch (error) {
    console.error(
      "Fatal error in processQueue:",
      error instanceof Error ? error.message : String(error)
    );
    return { processed: 0, failed: 0 };
  }
}

Deno.serve(async () => {
  const result = await processQueue();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
