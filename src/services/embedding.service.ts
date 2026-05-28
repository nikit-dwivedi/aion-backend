import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export interface EmbeddingProvider {
  name: string;
  generateEmbedding(text: string): Promise<number[]>;
  getDimensions(): number;
  isConfigured(): boolean;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  name = 'gemini';
  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
    this.modelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  getDimensions(): number {
    return 768; // text-embedding-004 dimensions
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client) throw new Error('[GeminiEmbedding] API Key not set');
    const result = await this.client.models.embedContent({
      model: this.modelName,
      contents: text,
    });
    const embedding = result.embeddings?.[0]?.values;
    if (!embedding) throw new Error('[GeminiEmbedding] Failed to generate embedding');
    return embedding;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai';
  private client: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  getDimensions(): number {
    return 768;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client) throw new Error('[OpenAIEmbedding] API Key not set');
    const result = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 768, // Request exactly 768 dimensions for PostgreSQL schema consistency
    });
    const embedding = result.data[0]?.embedding;
    if (!embedding) throw new Error('[OpenAIEmbedding] Failed to generate embedding');
    return embedding;
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  name = 'ollama';
  private client: OpenAI | null = null;

  constructor() {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
    this.client = new OpenAI({
      baseURL: ollamaUrl,
      apiKey: 'ollama', // Bypass OpenAI SDK constraint
    });
  }

  isConfigured(): boolean {
    return true; // Ollama fallback is assumed active locally
  }

  getDimensions(): number {
    return 768;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client) throw new Error('[OllamaEmbedding] Client not initialized');
    const result = await this.client.embeddings.create({
      model: 'nomic-embed-text',
      input: text,
    });
    const embedding = result.data[0]?.embedding;
    if (!embedding) throw new Error('[OllamaEmbedding] Failed to generate embedding');
    
    // Align dimensions if mismatch
    if (embedding.length > 768) {
      return embedding.slice(0, 768);
    }
    return embedding;
  }
}

/**
 * Fallback orchestrator for embeddings.
 * Chains active providers and queries them sequentially in case of rate limits or provider downtime.
 */
export class OrchestratedEmbeddingService {
  private providers: EmbeddingProvider[] = [];

  constructor() {
    // Instantiate providers
    const gemini = new GeminiEmbeddingProvider();
    const openai = new OpenAIEmbeddingProvider();
    const ollama = new OllamaEmbeddingProvider();

    // Prioritize providers based on LLM_PROVIDER env variable
    const primary = process.env.LLM_PROVIDER || 'gemini';
    if (primary === 'gemini') {
      this.providers = [gemini, openai, ollama];
    } else if (primary === 'openai') {
      this.providers = [openai, gemini, ollama];
    } else {
      this.providers = [ollama, gemini, openai];
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        continue;
      }

      try {
        console.log(`[EmbeddingService] Querying embedding provider: ${provider.name}`);
        const vector = await provider.generateEmbedding(text);
        if (vector && vector.length === 768) {
          return vector;
        } else if (vector) {
          console.warn(`[EmbeddingService] Dimension mismatch (${vector.length} vs 768) on ${provider.name}. Slicing/padding.`);
          if (vector.length > 768) return vector.slice(0, 768);
          // Pad with zeros if somehow smaller
          return [...vector, ...new Array(768 - vector.length).fill(0)];
        }
      } catch (err: any) {
        console.error(`[EmbeddingService] Provider ${provider.name} failed:`, err.message || err);
        errors.push(err);
      }
    }

    throw new Error(`[EmbeddingService] All configured embedding providers failed. Errors: [${errors.map(e => e.message).join(', ')}]`);
  }

  getDimensions(): number {
    return 768;
  }
}

export const embeddingService = new OrchestratedEmbeddingService();
