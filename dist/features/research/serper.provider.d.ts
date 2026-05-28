import type { ResearchProvider, ResearchResult } from './research_provider.interface.js';
export declare class SerperProvider implements ResearchProvider {
    private apiKey;
    constructor();
    search(query: string): Promise<ResearchResult[]>;
}
//# sourceMappingURL=serper.provider.d.ts.map