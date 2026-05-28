export interface EmbeddingProvider {
    name: string;
    generateEmbedding(text: string): Promise<number[]>;
    getDimensions(): number;
    isConfigured(): boolean;
}
export declare class GeminiEmbeddingProvider implements EmbeddingProvider {
    name: string;
    private client;
    private modelName;
    constructor();
    isConfigured(): boolean;
    getDimensions(): number;
    generateEmbedding(text: string): Promise<number[]>;
}
export declare class OpenAIEmbeddingProvider implements EmbeddingProvider {
    name: string;
    private client;
    constructor();
    isConfigured(): boolean;
    getDimensions(): number;
    generateEmbedding(text: string): Promise<number[]>;
}
export declare class OllamaEmbeddingProvider implements EmbeddingProvider {
    name: string;
    private client;
    constructor();
    isConfigured(): boolean;
    getDimensions(): number;
    generateEmbedding(text: string): Promise<number[]>;
}
/**
 * Fallback orchestrator for embeddings.
 * Chains active providers and queries them sequentially in case of rate limits or provider downtime.
 */
export declare class OrchestratedEmbeddingService {
    private providers;
    constructor();
    generateEmbedding(text: string): Promise<number[]>;
    getDimensions(): number;
}
export declare const embeddingService: OrchestratedEmbeddingService;
//# sourceMappingURL=embedding.service.d.ts.map