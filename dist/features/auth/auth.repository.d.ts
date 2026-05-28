export declare class AuthRepository {
    static findUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        passwordHash: string;
        timezone: string;
        tier: string;
        llmUsage: number;
        createdAt: Date;
        dailyInferenceTokens: number;
        monthlyInferenceTokens: number;
        embeddingUsage: number;
        researchRequests: number;
        planningExecutions: number;
        insightGenerations: number;
        retrievalQueries: number;
        lastUsageResetAt: Date;
    } | undefined>;
    static createUser(email: string, passwordHash: string, timezone?: string): Promise<{
        id: string;
        email: string;
        passwordHash: string;
        timezone: string;
        tier: string;
        llmUsage: number;
        createdAt: Date;
        dailyInferenceTokens: number;
        monthlyInferenceTokens: number;
        embeddingUsage: number;
        researchRequests: number;
        planningExecutions: number;
        insightGenerations: number;
        retrievalQueries: number;
        lastUsageResetAt: Date;
    } | undefined>;
}
//# sourceMappingURL=auth.repository.d.ts.map