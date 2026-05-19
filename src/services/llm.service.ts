import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export type LLMProvider = 'gemini' | 'openai' | 'ollama';

export interface GenerateOptions {
  prompt: string;
  systemInstruction?: string;
  mediaBuffer?: string; // base64 string
  mimeType?: string;
}

class LLMService {
  private provider: LLMProvider;
  private geminiClient: GoogleGenAI | null = null;
  private openAIClient: OpenAI | null = null;

  private textModel: string;
  private embeddingModel: string;

  constructor() {
    this.provider = (process.env.LLM_PROVIDER as LLMProvider) || 'gemini';
    this.textModel = process.env.LLM_MODEL || 'gemini-2.5-flash';
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-004';

    console.log(`[LLMService] Initializing with provider: ${this.provider}`);
    console.log(`[LLMService] Text Model: ${this.textModel} | Embedding Model: ${this.embeddingModel}`);

    if (this.provider === 'gemini') {
      this.geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    } else if (this.provider === 'ollama') {
      this.openAIClient = new OpenAI({
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        apiKey: 'ollama', // Required by SDK but ignored by Ollama
      });
      // Safely default if missing in env
      if (!process.env.LLM_MODEL) this.textModel = 'llama3';
      if (!process.env.EMBEDDING_MODEL) this.embeddingModel = 'nomic-embed-text';
    } else if (this.provider === 'openai') {
      this.openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
      if (!process.env.LLM_MODEL) this.textModel = 'gpt-4o';
      if (!process.env.EMBEDDING_MODEL) this.embeddingModel = 'text-embedding-3-small';
    }
  }

  // Built-in retry logic for all providers (mostly for Gemini 429s, but safe for all)
  private async callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? error?.httpStatusCode;
        if (status === 429 && attempt < maxRetries) {
          const waitMs = attempt * 15000;
          console.warn(`[${this.provider}] Rate limited. Retrying in ${waitMs / 1000}s (attempt ${attempt}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, waitMs));
        } else {
          throw error;
        }
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Generates text content across any configured provider.
   */
  async generateContent(options: GenerateOptions): Promise<string> {
    return this.callWithRetry(async () => {
      // 1. GEMINI (or Fallback if Media provided to local model)
      if (this.provider === 'gemini' || (options.mediaBuffer && this.provider === 'ollama')) {
        let contents: any;
        
        if (options.mediaBuffer && this.provider === 'ollama') {
          console.warn("[LLMService] WARNING: Falling back to Gemini for media extraction because Ollama lacks native multimodal support.");
        }

        // Initialize temporary client if we are falling back
        const client = this.provider === 'gemini' ? this.geminiClient! : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
        
        // Handle Multimodal Media
        if (options.mediaBuffer) {
           let mime = options.mimeType || 'image/jpeg';
           if (mime === 'application/octet-stream') mime = 'audio/mp4';
           contents = [
             { text: options.systemInstruction ? `${options.systemInstruction}\n\n${options.prompt}` : options.prompt },
             { inlineData: { data: options.mediaBuffer, mimeType: mime } }
           ];
        } else {
           contents = options.systemInstruction ? `${options.systemInstruction}\n\n${options.prompt}` : options.prompt;
        }
        
        const result = await client.models.generateContent({
           model: 'gemini-2.5-flash', // Always use flash for extraction
           contents: contents,
        });
        return result.text ?? '';
      } 
      
      // 2. OPENAI / OLLAMA (Text only)
      else if (this.provider === 'ollama' || this.provider === 'openai') {
         const messages: any[] = [];
         if (options.systemInstruction) {
           messages.push({ role: 'system', content: options.systemInstruction });
         }
         messages.push({ role: 'user', content: options.prompt });

         const result = await this.openAIClient!.chat.completions.create({
           model: this.textModel,
           messages,
         });

         return result.choices[0]?.message?.content ?? '';
      }

      throw new Error(`Unsupported LLM provider: ${this.provider}`);
    });
  }

  /**
   * Generates embeddings across any configured provider.
   */
  async embedContent(text: string): Promise<number[]> {
    return this.callWithRetry(async () => {
      if (this.provider === 'gemini') {
        const result = await this.geminiClient!.models.embedContent({
          model: this.embeddingModel,
          contents: text,
        });
        return result.embeddings?.[0]?.values ?? [];
      } 
      
      else if (this.provider === 'ollama' || this.provider === 'openai') {
        const result = await this.openAIClient!.embeddings.create({
          model: this.embeddingModel,
          input: text,
        });
        return result.data[0]?.embedding ?? [];
      }

      throw new Error(`Unsupported LLM provider: ${this.provider}`);
    });
  }
}

// Export a singleton instance
export const llm = new LLMService();
