export declare class ExportRepository {
    static getAllNodes(userId: string): Promise<{
        id: string;
        userId: string;
        nodeType: string;
        content: string;
        embedding: number[] | null;
        metadata: unknown;
        createdAt: Date;
        updatedAt: Date;
        reinforcementCount: number;
        lastReinforcedAt: Date | null;
        retrievalVelocity: number;
        cognitiveMomentum: number;
        attentionHalfLife: number;
    }[]>;
    static getAllEdges(nodeIds: string[]): Promise<Record<string, unknown>[]>;
}
//# sourceMappingURL=export.repository.d.ts.map