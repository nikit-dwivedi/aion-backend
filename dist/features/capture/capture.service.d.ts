export declare function validateUrlForSsrf(urlStr: string): Promise<string>;
export declare class CaptureService {
    static captureMedia(userId: string, type: string, content?: string, mediaFile?: Express.Multer.File): Promise<{
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
    static capturePdf(userId: string, file: Express.Multer.File): Promise<{
        event: {
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
        } | undefined;
        stats: {
            pages: any;
            characters: any;
        };
    }>;
    static captureUrl(userId: string, url: string): Promise<{
        event: {
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
        } | undefined;
        stats: {
            title: string;
            characters: number;
        };
    }>;
}
//# sourceMappingURL=capture.service.d.ts.map