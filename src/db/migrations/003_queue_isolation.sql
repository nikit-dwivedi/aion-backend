-- ============================================================================
-- AION Production Hardening Migration 003
-- ============================================================================
-- Decouples the generic memory queue into isolated, priority-segregated
-- messaging channels. Replaces old notify_event_queue() trigger.
-- Adds updated_at column to events table for latency tracking.
-- ============================================================================

-- Add updated_at column to events table for latency tracking
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Create trigger to automatically update updated_at on UPDATE
CREATE OR REPLACE FUNCTION update_events_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_events_timestamp ON events;

CREATE TRIGGER trg_update_events_timestamp
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_events_timestamp();

CREATE OR REPLACE FUNCTION notify_event_queue()
RETURNS trigger AS $$
DECLARE
  target_channel TEXT;
BEGIN
  -- 1. Route based on event type
  IF NEW.event_type = 'push_notification_requested' THEN
    target_channel := 'notification_queue';
    
  ELSIF NEW.event_type = 'research_requested' THEN
    target_channel := 'research_queue';
    
  ELSIF NEW.event_type IN ('retrieval_logged', 'retrieval_feedback') THEN
    target_channel := 'retrieval_learning_queue';
    
  ELSIF NEW.event_type IN (
    'decay_requested', 
    'reinforcement_requested', 
    'contradiction_requested', 
    'episodic_clustering_requested'
  ) THEN
    target_channel := 'background_evolution_queue';
    
  ELSIF NEW.event_type IN ('memory_created', 'plan_update_requested') THEN
    -- Route to critical or normal depending on priority and immediate attention flag
    IF NEW.requires_immediate_attention = TRUE OR NEW.priority IN ('urgent', 'critical', 'CRITICAL', 'URGENT') THEN
      target_channel := 'critical_cognition_queue';
    ELSE
      target_channel := 'normal_cognition_queue';
    END IF;
    
  ELSE
    -- Default fallback for other event types
    target_channel := 'normal_cognition_queue';
  END IF;

  -- 2. Dispatch payload to the chosen channel
  PERFORM pg_notify(target_channel, json_build_object(
    'id', NEW.id,
    'user_id', NEW.user_id,
    'event_type', NEW.event_type
  )::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure the trigger is attached (it was created in 001_production_hardening.sql, but we make sure here)
DROP TRIGGER IF EXISTS trg_event_notify ON events;

CREATE TRIGGER trg_event_notify
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_event_queue();
