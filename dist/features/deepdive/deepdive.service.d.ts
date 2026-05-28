export declare class DeepDiveService {
    getThoughtHistory(userId: string, rawThoughtId: string): Promise<{
        rawThought: unknown;
        summary: {};
        history: {
            role: any;
            content: unknown;
        }[];
    }>;
    chatWithThought(userId: string, rawThoughtId: string, message: string): Promise<{
        response: any;
        updatedSummary: any;
    }>;
}
//# sourceMappingURL=deepdive.service.d.ts.map