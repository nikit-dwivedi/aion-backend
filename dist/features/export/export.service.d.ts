export declare class ExportService {
    static getExportData(userId: string): Promise<{
        exportedAt: string;
        nodes: {
            id: string;
            type: string;
            content: string;
            metadata: unknown;
            createdAt: Date;
        }[];
        edges: {
            source: any;
            target: any;
            relation: any;
            weight: any;
        }[];
        stats: {
            totalNodes: number;
            totalEdges: number;
            memories: number;
            projects: number;
            entities: number;
        };
    }>;
}
//# sourceMappingURL=export.service.d.ts.map