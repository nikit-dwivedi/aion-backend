export declare class PlanningService {
    static generateBreakdown(userId: string, goal: string): Promise<any>;
    /**
     * Fetches the persisted daily plan for today. If none exists, generates one on-the-fly.
     */
    static generateSchedule(userId: string): Promise<any>;
}
//# sourceMappingURL=planning.service.d.ts.map