import { type Request, type Response, type NextFunction } from 'express';
export declare const TIER_LIMITS: {
    free: {
        dailyInferenceTokens: number;
        researchRequests: number;
        planningExecutions: number;
        retrievalQueries: number;
        insightGenerations: number;
    };
    pro: {
        dailyInferenceTokens: number;
        researchRequests: number;
        planningExecutions: number;
        retrievalQueries: number;
        insightGenerations: number;
    };
};
/**
 * Middleware to check if a user is within their subscription tier's usage limits.
 */
export declare const checkQuota: (feature: "capture" | "deepdive" | "research" | "planning" | "retrieval" | "insights") => (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
/**
 * Helper utility to increment user's dynamic quota counters.
 */
export declare const incrementQuotaUsage: (userId: string, metrics: {
    tokens?: number;
    research?: boolean;
    planning?: boolean;
    retrieval?: boolean;
    insights?: boolean;
}) => Promise<void>;
/**
 * Backwards compatible legacy usage counter
 */
export declare const incrementUsage: (userId: string) => Promise<void>;
//# sourceMappingURL=quota.middleware.d.ts.map