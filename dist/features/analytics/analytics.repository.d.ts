export declare class AnalyticsRepository {
    static getHourlyDistribution(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getDowDistribution(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getDailyStreak(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getTotalStats(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getTopProjects(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getTopEntities(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getSentimentTrend(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getCaptureTrend(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getRecurringConcerns(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getPeople(userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
}
//# sourceMappingURL=analytics.repository.d.ts.map