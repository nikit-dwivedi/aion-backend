-- Migration to add loops table
CREATE TABLE IF NOT EXISTS loops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  primary_emotion TEXT NOT NULL DEFAULT 'neutral',
  loop_category TEXT NOT NULL DEFAULT 'other',
  avoidance_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  resolution_confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  trigger_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  repetition_count INTEGER NOT NULL DEFAULT 1,
  related_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'emerging',
  snoozed_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loops_user_status ON loops(user_id, status);
