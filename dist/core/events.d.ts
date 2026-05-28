import { z } from 'zod';
export type EventProcessingStatus = 'pending' | 'processing' | 'retrying' | 'failed' | 'completed' | 'dead_lettered';
export declare const MemoryCreatedPayloadSchema: z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        audio: "audio";
        image: "image";
        text: "text";
        video: "video";
    }>;
    mediaBase64: z.ZodOptional<z.ZodString>;
    mimeType: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const MemoryProcessedPayloadSchema: z.ZodObject<{
    originalEventId: z.ZodString;
    summary: z.ZodString;
}, z.core.$strip>;
export declare const ResearchRequestedPayloadSchema: z.ZodObject<{
    query: z.ZodString;
    sourceEventId: z.ZodOptional<z.ZodString>;
    sourceSummary: z.ZodString;
}, z.core.$strip>;
export declare const ResearchCompletedPayloadSchema: z.ZodObject<{
    sourceResearchId: z.ZodString;
    query: z.ZodString;
    summary: z.ZodString;
}, z.core.$strip>;
export declare const PlanUpdateRequestedPayloadSchema: z.ZodObject<{
    reason: z.ZodString;
    newInfo: z.ZodString;
    sourceEventId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PlanUpdateProcessedPayloadSchema: z.ZodObject<{
    sourcePlanUpdateId: z.ZodString;
}, z.core.$strip>;
export declare const PlanGeneratedPayloadSchema: z.ZodObject<{
    plan: z.ZodAny;
}, z.core.$strip>;
export declare const PushNotificationRequestedPayloadSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    type: z.ZodString;
}, z.core.$strip>;
export declare const MemoryReinforcedPayloadSchema: z.ZodObject<{
    nodeId: z.ZodString;
    count: z.ZodNumber;
}, z.core.$strip>;
export declare const EpisodeCreatedPayloadSchema: z.ZodObject<{
    episodeNodeId: z.ZodString;
    title: z.ZodString;
    matchingNodeIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const ContradictionDetectedPayloadSchema: z.ZodObject<{
    contradictionNodeId: z.ZodString;
    inconsistency: z.ZodString;
    sourceNodeId: z.ZodString;
    targetNodeId: z.ZodString;
}, z.core.$strip>;
export declare const ThoughtUpdatedPayloadSchema: z.ZodObject<{
    rawThoughtId: z.ZodString;
    oldSummary: z.ZodString;
    newSummary: z.ZodString;
}, z.core.$strip>;
export declare const DeepDiveChatPayloadSchema: z.ZodObject<{
    rawThoughtId: z.ZodString;
    message: z.ZodString;
    response: z.ZodString;
}, z.core.$strip>;
export declare const GenericRequestedPayloadSchema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
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
export declare function insertEvent(txOrDb: any, input: InsertEventInput): Promise<any>;
//# sourceMappingURL=events.d.ts.map