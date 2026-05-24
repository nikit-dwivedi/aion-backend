import { pgTable, text, timestamp, jsonb, vector, uuid, doublePrecision, integer } from 'drizzle-orm/pg-core';

// The Users Table (Authentication)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').default('UTC').notNull(), // IANA timezone e.g. 'Asia/Kolkata'
  tier: text('tier').default('free').notNull(),        // Subscription tier: 'free' or 'pro'
  llmUsage: integer('llm_usage').default(0).notNull(), // LLM token/call tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Cognitive Event Journal (Immutable Source of Truth)
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clientId: text('client_id'), // Optional: Client-generated ID for offline sync idempotency
  eventType: text('event_type').notNull(), // e.g., 'memory_created', 'memory_processed', 'deep_dive_chat', 'thought_updated', 'plan_generated'
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Graph Nodes
export const nodes = pgTable('nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  nodeType: text('node_type').notNull(), // e.g., 'raw_thought', 'memory', 'project', 'person', 'entity', 'conversation_turn', 'daily_plan', 'action_item'
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }), // text-embedding-004 size
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// The Graph Edges
export const edges = pgTable('edges', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceNodeId: uuid('source_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: uuid('target_node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  relationType: text('relation_type').notNull(), // e.g., 'relates_to', 'mentions', 'contradicts', 'summarizes', 'similar_to'
  weight: doublePrecision('weight').default(1.0).notNull(), // For behavioral strength modeling
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
