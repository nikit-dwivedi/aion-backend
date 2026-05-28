export interface ResearchResult {
    title: string;
    snippet: string;
    url: string;
}
export interface ResearchProvider {
    search(query: string): Promise<ResearchResult[]>;
}
//# sourceMappingURL=research_provider.interface.d.ts.map