export interface AIConnectorOptions {
    prompt: string;
    systemInstruction?: string;
    mediaBuffer?: string;
    mimeType?: string;
    subsystem?: 'extractor' | 'orchestration' | 'research' | 'clustering' | 'contradiction' | 'episode' | 'insight';
    priority?: string;
}
export type ProviderType = 'gemini' | 'openai' | 'ollama';
export declare class AIConnectorService {
    private primaryProvider;
    private providersOrder;
    private inferenceQueue;
    private geminiClient;
    private openAIClient;
    private ollamaClient;
    constructor();
    private initializeClients;
    /**
     * Safe helper to execute functions with exponential backoff for rate limits (429)
     */
    private executeWithRetry;
    /**
     * Generates text content across providers with transparent fallback execution.
     */
    generateContent(options: AIConnectorOptions): Promise<string>;
    generateContentWithMetrics(options: AIConnectorOptions): Promise<{
        text: string;
        usage: {
            promptTokens: number;
            completionTokens: number;
        };
    }>;
    /**
     * Generates vector embeddings with transparent fallback and strict 768 dimension alignment.
     */
    embedContent(text: string): Promise<number[]>;
    private isProviderConfigured;
    private callProviderGenerate;
    private callProviderEmbed;
}
export declare const aiConnector: AIConnectorService;
//# sourceMappingURL=ai_connector.service.d.ts.map