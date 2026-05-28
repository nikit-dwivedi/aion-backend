export declare class FocusService {
    /**
     * Generates the ultra-minimal Focus Daily summary for a user.
     */
    static getFocusToday(userId: string): Promise<{
        greeting: string;
        cognitivePressureScore: number;
        primaryLoop: {
            id: string;
            title: string;
            summary: string;
            primaryEmotion: string;
            loopCategory: string;
            repetitionCount: number;
        } | null;
        secondaryLoops: {
            id: string;
            title: string;
            summary: string;
            primaryEmotion: string;
            loopCategory: string;
            repetitionCount: number;
        }[];
        closureSuggestion: string;
        reflectionInsight: string;
    }>;
}
//# sourceMappingURL=focus.service.d.ts.map