-- ============================================================================
-- AION Production Hardening Migration 001
-- ============================================================================
-- This migration adds:
--   1. LISTEN/NOTIFY triggers on the events table for push-based worker queues
--   2. Row-Level Security (RLS) on nodes, edges, and events tables
--   3. Composite indexes for performance and idempotency
--   4. HNSW vector index for fast similarity search
-- ============================================================================

-- ─── 1. LISTEN/NOTIFY TRIGGERS ──────────────────────────────────────────────

-- Function: fires NOTIFY on the appropriate channel based on event_type
CREATE OR REPLACE FUNCTION notify_event_queue()
RETURNS trigger AS $$
BEGIN
  -- Route to the correct channel based on event_type
  IF NEW.event_type = 'memory_created' THEN
    PERFORM pg_notify('aion_memory_queue', json_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'event_type', NEW.event_type
    )::text);
  ELSIF NEW.event_type = 'research_requested' THEN
    PERFORM pg_notify('aion_research_queue', json_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'event_type', NEW.event_type
    )::text);
  ELSIF NEW.event_type = 'plan_update_requested' THEN
    PERFORM pg_notify('aion_plan_queue', json_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'event_type', NEW.event_type
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present (idempotent migration)
DROP TRIGGER IF EXISTS trg_event_notify ON events;

-- Create the trigger that fires AFTER INSERT on events
CREATE TRIGGER trg_event_notify
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_event_queue();

-- ─── 2. ROW-LEVEL SECURITY ─────────────────────────────────────────────────

-- Enable RLS on all tenant-scoped tables
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (critical for security)
ALTER TABLE nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE edges FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

-- Policy: nodes - users can only see/modify their own nodes
DROP POLICY IF EXISTS tenant_isolation_nodes ON nodes;
CREATE POLICY tenant_isolation_nodes ON nodes
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Policy: events - users can only see/modify their own events  
DROP POLICY IF EXISTS tenant_isolation_events ON events;
CREATE POLICY tenant_isolation_events ON events
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Policy: edges - users can only see edges between their own nodes
-- Edges don't have user_id directly, so we join through source_node_id
DROP POLICY IF EXISTS tenant_isolation_edges ON edges;
CREATE POLICY tenant_isolation_edges ON edges
  USING (
    EXISTS (
      SELECT 1 FROM nodes n
      WHERE n.id = edges.source_node_id
      AND n.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- ─── 3. PERFORMANCE INDEXES ────────────────────────────────────────────────

-- Composite index for tenant-scoped node queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_nodes_user_type
  ON nodes (user_id, node_type);

-- Composite index for tenant-scoped event queries
CREATE INDEX IF NOT EXISTS idx_events_user_type
  ON events (user_id, event_type);

-- Index for event creation time ordering
CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON events (created_at DESC);

-- Index for node creation time ordering (timeline queries)
CREATE INDEX IF NOT EXISTS idx_nodes_created_at
  ON nodes (user_id, created_at DESC);

-- Edge lookup indexes
CREATE INDEX IF NOT EXISTS idx_edges_source
  ON edges (source_node_id);

CREATE INDEX IF NOT EXISTS idx_edges_target
  ON edges (target_node_id);

-- Unique partial index on client_id for deduplication
-- Only applies to events that have a client_id set (offline sync events)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_client_id_unique
  ON events (client_id)
  WHERE client_id IS NOT NULL;

-- ─── 5. VECTOR SIMILARITY INDEX (HNSW) ─────────────────────────────────────

-- HNSW index for fast approximate nearest neighbor search on embeddings
-- Using cosine distance operator (<=>)
CREATE INDEX IF NOT EXISTS idx_nodes_embedding_hnsw
  ON nodes
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── 6. DLQ STATUS TRACKING ────────────────────────────────────────────────

-- Add processing status columns to events table for DLQ tracking
-- Using DO block for idempotency (don't fail if columns already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'processing_status'
  ) THEN
    ALTER TABLE events ADD COLUMN processing_status TEXT DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE events ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE events ADD COLUMN last_error TEXT;
  END IF;
END $$;

-- Index for finding pending events (worker fallback polling)
CREATE INDEX IF NOT EXISTS idx_events_processing_status
  ON events (processing_status, event_type)
  WHERE processing_status IN ('pending', 'retrying');
