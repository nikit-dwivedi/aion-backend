export declare class SearchService {
    static searchMemories(userId: string, query: string): Promise<{
        answer: string;
        context: {
            id: string;
            content: string;
            distance: unknown;
        }[];
    }>;
}
//# sourceMappingURL=search.service.d.ts.map