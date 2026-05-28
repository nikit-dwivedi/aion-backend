import { pgTable, text, timestamp, jsonb, vector, uuid, doublePrecision, integer, boolean } from 'drizzle-orm/pg-core';

// The Users Table (Authentication)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').default('UTC').notNull(), // IANA timezone e.g. 'Asia/Kolkata'
  tier: text('tier').default('free').notNull(),        // Subscription tier: 'free' or 'pro'
  llmUsage: integer('llm_usage').default(0).notNull(), // LLM token/call tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  dailyInferenceTokens: integer('daily_inference_tokens').default(0).notNull(),
  monthlyInferenceTokens: integer('monthly_inference_tokens').default(0).notNull(),
  embeddingUsage: integer('embedding_usage').default(0).notNull(),
  researchRequests: integer('research_requests').default(0).notNull(),
  planningExecutions: integer('planning_executions').default(0).notNull(),
  insightGenerations: integer('insight_generations').default(0).notNull(),
  retrievalQueries: integer('retrieval_queries').default(0).notNull(),
  lastUsageResetAt: timestamp('last_usage_reset_at').defaultNow().notNull(),
});

// The Cognitive Event Journal (Immutable Source of Truth)
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clientId: text('client_id'), // Optional: Client-generated ID for offline sync idempotency
  eventType: text('event_type').notNull(), // e.g., 'memory_created', 'memory_processed', 'deep_dive_chat', 'thought_updated', 'plan_generated'
  payload: jsonb('payload').notNull(),
  processingStatus: text('processing_status').default('pending').notNull(), // 'pending' | 'processing' | 'completed' | 'failed' | 'retrying'
  retryCount: integer('retry_count').default(0).notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  priority: text('priority').default('normal').notNull(),
  cognitiveUrgency: doublePrecision('cognitive_urgency').default(0.0).notNull(),
  planningRelevance: doublePrecision('planning_relevance').default(0.0).notNull(),
  requiresImmediateAttention: boolean('requires_immediate_attention').default(false).notNull(),
  estimatedCost: doublePrecision('estimated_cost').default(0.0).notNull(),
  tokenUsage: integer('token_usage').default(0).notNull(),
  processingWeight: doublePrecision('processing_weight').default(1.0).notNull(),
  cognitiveComplexity: doublePrecision('cognitive_complexity').default(0.0).notNull(),
});

// The Graph Nodes
export const nodes = pgTable('nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  nodeType: text('node_type').notNull(), // e.g., 'raw_thought', 'memory', 'project', 'person', 'entity', 'conversation_turn', 'daily_plan', 'action_item', 'episode', 'research', 'contradiction'
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }), // text-embedding-004 size
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  reinforcementCount: integer('reinforcement_count').default(0).notNull(),
  lastReinforcedAt: timestamp('last_reinforced_at'),
  retrievalVelocity: doublePrecision('retrieval_velocity').default(0.0).notNull(),
  cognitiveMomentum: doublePrecision('cognitive_momentum').default(0.0).notNull(),
  attentionHalfLife: doublePrecision('attention_half_life').default(7.0).notNull(),
});

// The Graph Edges
export const edges = pgTable('edges', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceNodeId: uuid('source_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: uuid('target_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  relationType: text('relation_type').notNull(), // e.g., 'relates_to', 'mentions', 'contradicts', 'summarizes', 'similar_to', 'part_of_episode', 'episode_related', 'emotionally_correlated', 'temporally_clustered', 'enriches', 'supports', 'expands'
  weight: doublePrecision('weight').default(1.0).notNull(), // For behavioral strength modeling
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Push Notifications Table
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  priority: text('priority').default('normal').notNull(),
  cognitiveImportance: doublePrecision('cognitive_importance').default(0.0).notNull(),
  interruptionScore: doublePrecision('interruption_score').default(0.0).notNull(),
  notificationFatigue: doublePrecision('notification_fatigue').default(0.0).notNull(),
  dismissalVelocity: doublePrecision('dismissal_velocity').default(0.0).notNull(),
  cognitiveOverloadScore: doublePrecision('cognitive_overload_score').default(0.0).notNull(),
  deliveryStatus: text('delivery_status').default('pending').notNull(), // 'pending' | 'sent' | 'delivered' | 'failed'
  lastSentAt: timestamp('last_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Retrieval Logs Table
export const retrievalLogs = pgTable('retrieval_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  queryText: text('query_text').notNull(),
  retrievedNodeId: uuid('retrieved_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  retrievalReason: text('retrieval_reason'),
  feedbackState: text('feedback_state').default('untracked').notNull(), // 'clicked' | 'ignored' | 'helpful' | 'dismissed' | 'followed_up' | 'untracked'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

