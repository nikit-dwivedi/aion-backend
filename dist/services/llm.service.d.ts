import { type AIConnectorOptions } from './ai_connector.service.js';
declare class LegacyLLMBridge {
    get isConfigured(): boolean;
    generateContent(options: AIConnectorOptions): Promise<string>;
    generateContentWithMetrics(options: AIConnectorOptions): Promise<{
        text: string;
        usage: {
            promptTokens: number;
            completionTokens: number;
        };
    }>;
    embedContent(text: string): Promise<number[]>;
}
export declare const llm: LegacyLLMBridge;
export {};
//# sourceMappingURL=llm.service.d.ts.map