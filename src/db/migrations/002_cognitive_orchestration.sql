-- ============================================================================
-- AION Cognitive Orchestration Migration 002
-- ============================================================================

-- Alter users
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_inference_tokens INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_inference_tokens INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS embedding_usage INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS research_requests INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS planning_executions INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS insight_generations INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS retrieval_queries INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_usage_reset_at TIMESTAMP DEFAULT now() NOT NULL;

-- Alter events
ALTER TABLE events ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal' NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cognitive_urgency DOUBLE PRECISION DEFAULT 0.0 NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS planning_relevance DOUBLE PRECISION DEFAULT 0.0 NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS requires_immediate_attention BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS estimated_cost DOUBLE PRECISION DEFAULT 0.0 NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS token_usage INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS processing_weight DOUBLE PRECISION DEFAULT 1.0 NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cognitive_complexity DOUBLE PRECISION DEFAULT 0.0 NOT NULL;

-- Alter nodes
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS reinforcement_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS last_reinforced_at TIMESTAMP;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS retrieval_velocity DOUBLE PRECISION DEFAULT 0.0 NOT NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS cognitive_momentum DOUBLE PRECISION DEFAULT 0.0 NOT NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS attention_half_life DOUBLE PRECISION DEFAULT 7.0 NOT NULL;

-- Create notifications
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"cognitive_importance" double precision DEFAULT 0 NOT NULL,
	"interruption_score" double precision DEFAULT 0 NOT NULL,
	"notification_fatigue" double precision DEFAULT 0 NOT NULL,
	"dismissal_velocity" double precision DEFAULT 0 NOT NULL,
	"cognitive_overload_score" double precision DEFAULT 0 NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Create retrieval_logs
CREATE TABLE IF NOT EXISTS "retrieval_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"retrieved_node_id" uuid NOT NULL,
	"retrieval_reason" text,
	"feedback_state" text DEFAULT 'untracked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Foreign Key Constraints
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_users_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_event_id_events_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "retrieval_logs" DROP CONSTRAINT IF EXISTS "retrieval_logs_user_id_users_id_fk";
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "retrieval_logs" DROP CONSTRAINT IF EXISTS "retrieval_logs_retrieved_node_id_nodes_id_fk";
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_retrieved_node_id_nodes_id_fk" FOREIGN KEY ("retrieved_node_id") REFERENCES "nodes"("id") ON DELETE cascade ON UPDATE no action;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_delivery ON notifications (user_id, delivery_status);
CREATE INDEX IF NOT EXISTS idx_retrieval_logs_user_feedback ON retrieval_logs (user_id, feedback_state);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE retrieval_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notifications ON notifications;
CREATE POLICY tenant_isolation_notifications ON notifications
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_retrieval_logs ON retrieval_logs;
CREATE POLICY tenant_isolation_retrieval_logs ON retrieval_logs
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
