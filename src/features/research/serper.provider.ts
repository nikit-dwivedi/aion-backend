import type { ResearchProvider, ResearchResult } from './research_provider.interface.js';

export class SerperProvider implements ResearchProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.SERPER_API_KEY || '';
  }

  async search(query: string): Promise<ResearchResult[]> {
    if (!this.apiKey) {
      console.warn('[SerperProvider] SERPER_API_KEY is not defined. Falling back to empty results.');
      return [];
    }

    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query }),
      });

      if (!response.ok) {
        throw new Error(`Serper API returned status ${response.status}`);
      }

      const data = await response.json() as any;
      const organic = data.organic || [];

      return organic.map((item: any) => ({
        title: item.title || '',
        snippet: item.snippet || item.snippetDescription || '',
        url: item.link || item.url || '',
      }));
    } catch (error) {
      console.error('[SerperProvider] Search request failed:', error);
      throw error;
    }
  }
}
