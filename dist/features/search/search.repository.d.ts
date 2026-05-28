export declare class SearchRepository {
    static findSimilarMemories(queryEmbedding: number[], userId: string, limit?: number): Promise<{
        id: string;
        content: string;
        distance: unknown;
    }[]>;
    static getMemoryConnections(memoryNodeIds: string[], userId: string): Promise<import("pg").QueryResult<Record<string, unknown>> | {
        rows: never[];
    }>;
}
//# sourceMappingURL=search.repository.d.ts.map