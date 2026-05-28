export declare class CopilotRepository {
    static getRecentMemories(userId: string, limit?: number): Promise<{
        id: string;
        content: string;
        createdAt: Date;
    }[]>;
    static getAllProjects(userId: string): Promise<{
        content: string;
    }[]>;
    static insertInsight(userId: string, insight: any): Promise<void>;
    static getInsights(userId: string, limit?: number): Promise<{
        id: string;
        content: string;
        createdAt: Date;
    }[]>;
}
//# sourceMappingURL=copilot.repository.d.ts.map