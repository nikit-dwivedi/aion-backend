export declare class GraphService {
    static getGraph(userId: string): Promise<{
        nodes: {
            id: string;
            type: string;
            label: string;
            content: string;
            heat: number;
        }[];
        edges: {
            id: any;
            source: any;
            target: any;
            relation: any;
            weight: any;
        }[];
    }>;
}
//# sourceMappingURL=graph.service.d.ts.map