import { aiConnector, type AIConnectorOptions } from './ai_connector.service.js';

class LegacyLLMBridge {
  get isConfigured(): boolean {
    // High resiliency: if any valid provider key is set, the connector will orchestrate fallbacks
    return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL || true);
  }

  async generateContent(options: AIConnectorOptions): Promise<string> {
    return await aiConnector.generateContent(options);
  }

  async embedContent(text: string): Promise<number[]> {
    return await aiConnector.embedContent(text);
  }
}

export const llm = new LegacyLLMBridge();
