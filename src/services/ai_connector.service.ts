import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export interface AIConnectorOptions {
  prompt: string;
  systemInstruction?: string;
  mediaBuffer?: string; // base64 string
  mimeType?: string;
}

export type ProviderType = 'gemini' | 'openai' | 'ollama';

export class AIConnectorService {
  private primaryProvider: ProviderType;
  private providersOrder: ProviderType[];

  // Clients
  private geminiClient: GoogleGenAI | null = null;
  private openAIClient: OpenAI | null = null;
  private ollamaClient: OpenAI | null = null;

  constructor() {
    this.primaryProvider = (process.env.LLM_PROVIDER as ProviderType) || 'gemini';
    
    // Define fallback sequence
    if (this.primaryProvider === 'gemini') {
      this.providersOrder = ['gemini', 'openai', 'ollama'];
    } else if (this.primaryProvider === 'openai') {
      this.providersOrder = ['openai', 'gemini', 'ollama'];
    } else {
      this.providersOrder = ['ollama', 'gemini', 'openai'];
    }

    this.initializeClients();
    console.log(`[AIConnector] Initialized with primary provider: ${this.primaryProvider}. Fallback order: ${this.providersOrder.join(' -> ')}`);
  }

  private initializeClients() {
    // 1. Gemini
    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (geminiKey) {
      this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
    }

    // 2. OpenAI
    const openAIKey = process.env.OPENAI_API_KEY || '';
    if (openAIKey) {
      this.openAIClient = new OpenAI({ apiKey: openAIKey });
    }

    // 3. Ollama
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
    this.ollamaClient = new OpenAI({
      baseURL: ollamaUrl,
      apiKey: 'ollama', // SDK constraint bypass
    });
  }

  /**
   * Safe helper to execute functions with exponential backoff for rate limits (429)
   */
  private async executeWithRetry<T>(provider: ProviderType, fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? error?.httpStatusCode ?? error?.response?.status;
        
        // Handle 429 Rate Limits exclusively with exponential backoff
        if (status === 429 && attempt < maxRetries) {
          const waitMs = attempt * 10000;
          console.warn(`[AIConnector][${provider}] Rate limit (429) encountered. Retrying in ${waitMs / 1000}s (attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        } else {
          throw error;
        }
      }
    }
    throw new Error(`Max retries exceeded for ${provider}`);
  }

  /**
   * Generates text content across providers with transparent fallback execution.
   */
  async generateContent(options: AIConnectorOptions): Promise<string> {
    const result = await this.generateContentWithMetrics(options);
    return result.text;
  }

  async generateContentWithMetrics(options: AIConnectorOptions): Promise<{ text: string, usage: { promptTokens: number, completionTokens: number } }> {
    const errors: Error[] = [];

    // Make options mutable so we can normalize MIME type
    const normalizedOptions = { ...options };

    if (normalizedOptions.mediaBuffer) {
      let mime = normalizedOptions.mimeType || '';
      if (!mime || mime === 'application/octet-stream') {
        const isAudio = (normalizedOptions.systemInstruction && /audio|voice|speech|listen/i.test(normalizedOptions.systemInstruction)) ||
                        (normalizedOptions.prompt && /audio|voice|speech|listen/i.test(normalizedOptions.prompt));
        mime = isAudio ? 'audio/mp4' : 'image/jpeg';
      }
      normalizedOptions.mimeType = mime;
    }

    let providers = [...this.providersOrder];
    if (normalizedOptions.mediaBuffer) {
      const multimodal: ProviderType[] = [];
      const others: ProviderType[] = [];
      for (const p of providers) {
        if (p === 'gemini' || p === 'openai') {
          multimodal.push(p);
        } else {
          others.push(p);
        }
      }
      providers = [...multimodal, ...others];
    }

    for (const provider of providers) {
      try {
        if (!this.isProviderConfigured(provider)) {
          console.log(`[AIConnector] Skipping unconfigured provider: ${provider}`);
          continue;
        }

        console.log(`[AIConnector] Attempting content generation with provider: ${provider}`);
        
        const response = await this.executeWithRetry(provider, () => 
          this.callProviderGenerate(provider, normalizedOptions)
        );

        if (response && (response.text || response.text === '')) {
          return {
            text: response.text,
            usage: response.usage || { promptTokens: 0, completionTokens: 0 }
          };
        }
      } catch (err: any) {
        console.error(`[AIConnector] Provider ${provider} failed:`, err?.message || err);
        errors.push(err);
      }
    }

    throw new Error(`AIConnector failed across all configured providers. Errors: [${errors.map(e => e.message).join(', ')}]`);
  }

  /**
   * Generates vector embeddings with transparent fallback and strict 768 dimension alignment.
   */
  async embedContent(text: string): Promise<number[]> {
    const errors: Error[] = [];

    for (const provider of this.providersOrder) {
      try {
        if (!this.isProviderConfigured(provider)) {
          continue;
        }

        console.log(`[AIConnector] Attempting vector embedding with provider: ${provider}`);

        const vector = await this.executeWithRetry(provider, () => 
          this.callProviderEmbed(provider, text)
        );

        if (vector && vector.length === 768) {
          return vector;
        } else if (vector && vector.length !== 768) {
          console.warn(`[AIConnector] Provider ${provider} returned embedding length mismatch (${vector.length} vs 768). Attempting slicing/resizing.`);
          if (vector.length > 768) {
            return vector.slice(0, 768);
          }
        }
      } catch (err: any) {
        console.error(`[AIConnector] Embedding fallback provider ${provider} failed:`, err?.message || err);
        errors.push(err);
      }
    }

    throw new Error(`AIConnector embedding extraction failed across all providers. Errors: [${errors.map(e => e.message).join(', ')}]`);
  }

  private isProviderConfigured(provider: ProviderType): boolean {
    if (provider === 'gemini') return !!this.geminiClient;
    if (provider === 'openai') return !!this.openAIClient;
    if (provider === 'ollama') return true; // Local fallback usually active
    return false;
  }

  private async callProviderGenerate(provider: ProviderType, options: AIConnectorOptions): Promise<{ text: string, usage?: { promptTokens: number, completionTokens: number } }> {
    // 1. GEMINI
    if (provider === 'gemini') {
      let contents: any;
      if (options.mediaBuffer) {
        contents = [
          { text: options.systemInstruction ? `${options.systemInstruction}\n\n${options.prompt}` : options.prompt },
          { inlineData: { data: options.mediaBuffer, mimeType: options.mimeType || 'image/jpeg' } }
        ];
      } else {
        contents = options.systemInstruction ? `${options.systemInstruction}\n\n${options.prompt}` : options.prompt;
      }

      const result = await this.geminiClient!.models.generateContent({
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
        contents: contents,
      });
      return {
        text: result.text ?? '',
        usage: {
          promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0
        }
      };
    }

    // 2. OPENAI
    if (provider === 'openai') {
      if (options.mediaBuffer) {
        let mime = options.mimeType || 'image/jpeg';
        const isImage = mime.startsWith('image/');
        
        if (isImage) {
          const messages: any[] = [];
          if (options.systemInstruction) {
            messages.push({ role: 'system', content: options.systemInstruction });
          }
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: options.prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${options.mediaBuffer}` }
              }
            ]
          });

          const result = await this.openAIClient!.chat.completions.create({
            model: 'gpt-4o',
            messages,
          });
          return {
            text: result.choices[0]?.message?.content ?? '',
            usage: {
              promptTokens: result.usage?.prompt_tokens ?? 0,
              completionTokens: result.usage?.completion_tokens ?? 0
            }
          };
        } else {
          console.warn("[AIConnector] OpenAI fallback lacks direct inline base64 audio processing. Attempting standard text query.");
        }
      }

      const messages: any[] = [];
      if (options.systemInstruction) {
        messages.push({ role: 'system', content: options.systemInstruction });
      }
      messages.push({ role: 'user', content: options.prompt });

      const result = await this.openAIClient!.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
      });
      return {
        text: result.choices[0]?.message?.content ?? '',
        usage: {
          promptTokens: result.usage?.prompt_tokens ?? 0,
          completionTokens: result.usage?.completion_tokens ?? 0
        }
      };
    }

    // 3. OLLAMA
    if (provider === 'ollama') {
      if (options.mediaBuffer) {
        let mime = options.mimeType || 'image/jpeg';
        const isImage = mime.startsWith('image/');
        if (isImage) {
          const messages: any[] = [];
          if (options.systemInstruction) {
            messages.push({ role: 'system', content: options.systemInstruction });
          }
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: options.prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${options.mediaBuffer}` }
              }
            ]
          });

          const result = await this.ollamaClient!.chat.completions.create({
            model: process.env.OLLAMA_MODEL || 'llama3',
            messages,
          });
          return {
            text: result.choices[0]?.message?.content ?? '',
            usage: {
              promptTokens: result.usage?.prompt_tokens ?? 0,
              completionTokens: result.usage?.completion_tokens ?? 0
            }
          };
        }
      }

      const messages: any[] = [];
      if (options.systemInstruction) {
        messages.push({ role: 'system', content: options.systemInstruction });
      }
      messages.push({ role: 'user', content: options.prompt });

      const result = await this.ollamaClient!.chat.completions.create({
        model: process.env.OLLAMA_MODEL || 'llama3',
        messages,
      });
      return {
        text: result.choices[0]?.message?.content ?? '',
        usage: {
          promptTokens: result.usage?.prompt_tokens ?? 0,
          completionTokens: result.usage?.completion_tokens ?? 0
        }
      };
    }

    return { text: '' };
  }

  private async callProviderEmbed(provider: ProviderType, text: string): Promise<number[]> {
    // 1. GEMINI
    if (provider === 'gemini') {
      const result = await this.geminiClient!.models.embedContent({
        model: process.env.EMBEDDING_MODEL || 'text-embedding-004',
        contents: text,
      });
      return result.embeddings?.[0]?.values ?? [];
    }

    // 2. OPENAI
    if (provider === 'openai') {
      const result = await this.openAIClient!.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768, // Force strict alignment to pgvector dimensions inside database schemas
      });
      return result.data[0]?.embedding ?? [];
    }

    // 3. OLLAMA
    if (provider === 'ollama') {
      const result = await this.ollamaClient!.embeddings.create({
        model: 'nomic-embed-text', // Standard 768 dimensions vector
        input: text,
      });
      return result.data[0]?.embedding ?? [];
    }

    return [];
  }
}

export const aiConnector = new AIConnectorService();
