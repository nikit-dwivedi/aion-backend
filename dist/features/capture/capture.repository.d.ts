export declare class CaptureRepository {
    static insertMemoryEvent(userId: string, payload: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        clientId: string | null;
        eventType: string;
        payload: unknown;
        processingStatus: string;
        retryCount: number;
        lastError: string | null;
        priority: string;
        cognitiveUrgency: number;
        planningRelevance: number;
        requiresImmediateAttention: boolean;
        estimatedCost: number;
        tokenUsage: number;
        processingWeight: number;
        cognitiveComplexity: number;
    } | undefined>;
}
//# sourceMappingURL=capture.repository.d.ts.map