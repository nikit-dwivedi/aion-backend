export declare class PlanningRepository {
    static resolveNode(userId: string, nodeType: string, content: string, tx?: any): Promise<any>;
    static getActiveProjects(userId: string): Promise<{
        content: string;
    }[]>;
    static saveGoalBreakdown(userId: string, breakdown: any): Promise<void>;
    static getActiveTasks(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getRecentInsights(userId: string): Promise<{
        content: string;
    }[]>;
}
//# sourceMappingURL=planning.repository.d.ts.map