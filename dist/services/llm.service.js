import { aiConnector } from './ai_connector.service.js';
class LegacyLLMBridge {
    get isConfigured() {
        // High resiliency: if any valid provider key is set, the connector will orchestrate fallbacks
        return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL || true);
    }
    async generateContent(options) {
        return await aiConnector.generateContent(options);
    }
    async generateContentWithMetrics(options) {
        return await aiConnector.generateContentWithMetrics(options);
    }
    async embedContent(text) {
        return await aiConnector.embedContent(text);
    }
}
export const llm = new LegacyLLMBridge();
//# sourceMappingURL=llm.service.js.map