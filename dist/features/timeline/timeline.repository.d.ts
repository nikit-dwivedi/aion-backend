export declare class TimelineRepository {
    static getRecentMemories(userId: string, limit?: number): Promise<{
        id: string;
        nodeType: string;
        content: string;
        metadata: unknown;
        createdAt: Date;
    }[]>;
    static getProjectForMemory(memoryId: string, userId: string): Promise<any>;
    static getResurfacedMemories(userId: string): Promise<Record<string, unknown>[]>;
    static getMemoryById(userId: string, memoryId: string): Promise<{
        id: string;
        userId: string;
        nodeType: string;
        content: string;
        embedding: number[] | null;
        metadata: unknown;
        createdAt: Date;
        updatedAt: Date;
        reinforcementCount: number;
        lastReinforcedAt: Date | null;
        retrievalVelocity: number;
        cognitiveMomentum: number;
        attentionHalfLife: number;
    } | undefined>;
    static getMemoryConnections(memoryId: string, userId: string): Promise<Record<string, unknown>[]>;
    static getSimilarMemories(userId: string, memoryId: string, embedding: number[]): Promise<{
        id: string;
        content: string;
        createdAt: Date;
        distance: unknown;
    }[]>;
    static deleteMemory(memoryId: string, userId: string): Promise<void>;
}
//# sourceMappingURL=timeline.repository.d.ts.map