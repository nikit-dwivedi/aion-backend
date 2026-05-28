import { z } from 'zod';
import { events } from '../db/schema.js';

// Define event status enum
export type EventProcessingStatus = 'pending' | 'processing' | 'retrying' | 'failed' | 'completed' | 'dead_lettered';

// Zod schemas for event payloads
export const MemoryCreatedPayloadSchema = z.object({
  content: z.string().optional(),
  type: z.enum(['text', 'audio', 'image', 'video']),
  mediaBase64: z.string().optional(),
  mimeType: z.string().optional(),
});

export const MemoryProcessedPayloadSchema = z.object({
  originalEventId: z.string().uuid(),
  summary: z.string(),
});

export const ResearchRequestedPayloadSchema = z.object({
  query: z.string(),
  sourceEventId: z.string().uuid().optional(),
  sourceSummary: z.string(),
});

export const ResearchCompletedPayloadSchema = z.object({
  sourceResearchId: z.string().uuid(),
  query: z.string(),
  summary: z.string(),
});

export const PlanUpdateRequestedPayloadSchema = z.object({
  reason: z.string(),
  newInfo: z.string(),
  sourceEventId: z.string().uuid().optional(),
});

export const PlanUpdateProcessedPayloadSchema = z.object({
  sourcePlanUpdateId: z.string().uuid(),
});

export const PlanGeneratedPayloadSchema = z.object({
  plan: z.any(),
});

export const PushNotificationRequestedPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  type: z.string(),
});

export const MemoryReinforcedPayloadSchema = z.object({
  nodeId: z.string().uuid(),
  count: z.number().int().positive(),
});

export const EpisodeCreatedPayloadSchema = z.object({
  episodeNodeId: z.string().uuid(),
  title: z.string(),
  matchingNodeIds: z.array(z.string().uuid()),
});

export const ContradictionDetectedPayloadSchema = z.object({
  contradictionNodeId: z.string().uuid(),
  inconsistency: z.string(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
});

export const ThoughtUpdatedPayloadSchema = z.object({
  rawThoughtId: z.string().uuid(),
  oldSummary: z.string(),
  newSummary: z.string(),
});

export const DeepDiveChatPayloadSchema = z.object({
  rawThoughtId: z.string().uuid(),
  message: z.string(),
  response: z.string(),
});

// Evolution request events can have empty/generic payloads
export const GenericRequestedPayloadSchema = z.record(z.string(), z.any()).optional();

// Map event types to payload schemas
const eventPayloadSchemas: Record<string, z.ZodTypeAny> = {
  memory_created: MemoryCreatedPayloadSchema,
  memory_processed: MemoryProcessedPayloadSchema,
  research_requested: ResearchRequestedPayloadSchema,
  research_completed: ResearchCompletedPayloadSchema,
  plan_update_requested: PlanUpdateRequestedPayloadSchema,
  plan_update_processed: PlanUpdateProcessedPayloadSchema,
  plan_generated: PlanGeneratedPayloadSchema,
  push_notification_requested: PushNotificationRequestedPayloadSchema,
  memory_reinforced: MemoryReinforcedPayloadSchema,
  episode_created: EpisodeCreatedPayloadSchema,
  contradiction_detected: ContradictionDetectedPayloadSchema,
  decay_requested: GenericRequestedPayloadSchema,
  reinforcement_requested: GenericRequestedPayloadSchema,
  contradiction_requested: GenericRequestedPayloadSchema,
  episodic_clustering_requested: GenericRequestedPayloadSchema,
  thought_updated: ThoughtUpdatedPayloadSchema,
  deep_dive_chat: DeepDiveChatPayloadSchema,
};

export interface InsertEventInput {
  userId: string;
  eventType: string;
  payload: any;
  clientId?: string;
  priority?: 'low' | 'normal' | 'important' | 'urgent' | 'critical' | 'background' | 'low_priority_evolution';
  cognitiveUrgency?: number;
  planningRelevance?: number;
  requiresImmediateAttention?: boolean;
  estimatedCost?: number;
  tokenUsage?: number;
  processingWeight?: number;
  cognitiveComplexity?: number;
}

/**
 * Type-safe event insertion function.
 * Validates payload against corresponding Zod schemas before database execution.
 */
export async function insertEvent(txOrDb: any, input: InsertEventInput): Promise<any> {
  const schema = eventPayloadSchemas[input.eventType];
  if (!schema) {
    throw new Error(`[EventSystem] Unknown event type: ${input.eventType}`);
  }

  // Runtime payload validation
  const parsedPayload = schema.parse(input.payload);

  // Default priority if not provided
  let priority = input.priority || 'normal';
  
  // Enforce immediate attention flag if priority demands it
  const requiresImmediateAttention = input.requiresImmediateAttention || 
    priority === 'urgent' || 
    priority === 'critical';

  const [insertedEvent] = await txOrDb.insert(events).values({
    userId: input.userId,
    clientId: input.clientId || null,
    eventType: input.eventType,
    payload: parsedPayload,
    processingStatus: 'pending',
    retryCount: 0,
    priority,
    cognitiveUrgency: input.cognitiveUrgency || 0.0,
    planningRelevance: input.planningRelevance || 0.0,
    requiresImmediateAttention,
    estimatedCost: input.estimatedCost || 0.0,
    tokenUsage: input.tokenUsage || 0,
    processingWeight: input.processingWeight || 1.0,
    cognitiveComplexity: input.cognitiveComplexity || 0.0,
  }).returning();

  return insertedEvent;
}
