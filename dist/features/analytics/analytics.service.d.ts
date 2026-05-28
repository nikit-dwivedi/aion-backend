export declare class AnalyticsService {
    static getFocusAnalytics(userId: string): Promise<{
        hourlyDistribution: {
            hour: number;
            count: any;
        }[];
        dayOfWeekDistribution: {
            day: string | undefined;
            count: any;
        }[];
        currentStreak: number;
        peakHour: number | null;
        peakDay: string | null | undefined;
        totalMemories: any;
        firstCapture: any;
        lastCapture: any;
    }>;
    static getBehavioralPatterns(userId: string): Promise<{
        topProjects: Record<string, unknown>[];
        topEntities: Record<string, unknown>[];
        sentimentTrend: Record<string, unknown>[];
        captureTrend: Record<string, unknown>[];
        recurringConcerns: Record<string, unknown>[];
        people: Record<string, unknown>[];
    }>;
    static getForecast(userId: string): Promise<any>;
    static getCognitionDashboard(userId: string): Promise<{
        queueLatencySeconds: number;
        llmTokenUsage: any;
        estimatedInferenceCost: number;
        retryCount: any;
        deadLetterCount: any;
        reinforcementCount: number;
        notificationSuppressionRate: number;
        retrievalSuccessRate: number;
        metrics: Record<string, {
            avgLatency: number;
            count: number;
        }>;
    }>;
}
//# sourceMappingURL=analytics.service.d.ts.map