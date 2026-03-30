-- Rockwell Cortex: Complete database schema migration
-- Date: 2026-03-16
-- Includes: knowledge_entries table, embedding_queue table, indexes, trigger, RPC, and RLS policies

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_entries table
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

-- Create embedding_queue table
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

-- Create indexes on knowledge_entries
CREATE INDEX idx_knowledge_entries_category ON knowledge_entries(category);
CREATE INDEX idx_knowledge_entries_importance ON knowledge_entries(importance);
CREATE INDEX idx_knowledge_entries_embedding ON knowledge_entries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_knowledge_entries_fulltext ON knowledge_entries USING gin (to_tsvector('english', title || ' ' || content));

-- Create indexes on embedding_queue
CREATE INDEX idx_embedding_queue_status ON embedding_queue(status);
CREATE UNIQUE INDEX idx_embedding_queue_entry_id_pending ON embedding_queue(entry_id) WHERE status IN ('pending','processing');

-- Trigger function to auto-enqueue embeddings
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

-- Create trigger
CREATE TRIGGER trg_enqueue_embedding
AFTER INSERT OR UPDATE OF content ON knowledge_entries
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding();

-- Create hybrid search RPC function
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

-- Enable Row Level Security
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anon can read all entries
CREATE POLICY "anon_read" ON knowledge_entries
  FOR SELECT TO anon USING (true);

-- RLS Policy: embedding_queue service role only (no policy = service role bypasses RLS)
-- The service role key automatically bypasses all RLS policies, so no explicit policy needed
