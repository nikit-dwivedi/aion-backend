export declare class TimelineService {
    static getTimeline(userId: string): Promise<({
        content: string;
        title: string;
        recommendation: string;
        insightType: string;
        strength: number;
        relatedEntityOrProject: any;
        project: null;
        rawContent: null;
        sentiment: string;
        moodScore: number;
        id: string;
        nodeType: string;
        metadata: unknown;
        createdAt: Date;
    } | {
        project: any;
        rawContent: any;
        sentiment: any;
        moodScore: any;
        id: string;
        nodeType: string;
        content: string;
        metadata: unknown;
        createdAt: Date;
    })[]>;
    static getResurfaced(userId: string): Promise<{
        id: any;
        nodeType: string;
        content: any;
        createdAt: any;
        daysAgo: number;
    }[]>;
    static getMemoryDetail(userId: string, memoryId: string): Promise<{
        memory: {
            id: string;
            nodeType: string;
            content: string;
            title: any;
            insightType: any;
            recommendation: any;
            strength: any;
            relatedEntityOrProject: any;
            rawContent: any;
            sentiment: any;
            moodScore: any;
            rawThoughtId: {} | null;
            project: {} | null;
            entities: unknown[];
            createdAt: Date;
            relatedMemories: any[];
        };
    }>;
    static deleteMemory(memoryId: string, userId: string): Promise<void>;
}
//# sourceMappingURL=timeline.service.d.ts.map