import { pgTable, text, timestamp, jsonb, vector, uuid, doublePrecision } from 'drizzle-orm/pg-core';

// The Users Table (Authentication)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Cognitive Event Journal (Immutable Source of Truth)
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(), // e.g., 'memory_created', 'memory_search_initiated'
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The Graph Nodes
export const nodes = pgTable('nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  nodeType: text('node_type').notNull(), // e.g., 'memory', 'project', 'person'
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
  relationType: text('relation_type').notNull(), // e.g., 'relates_to', 'created_during', 'mentions'
  weight: doublePrecision('weight').default(1.0).notNull(), // For behavioral strength modeling
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
