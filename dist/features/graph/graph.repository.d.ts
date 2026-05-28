/**
 * Graph Repository with production-grade query optimizations:
 *   - Depth-bounded recursive traversal (D ≤ 2)
 *   - Loop detection via CYCLE clause
 *   - Supernode gating (max 50 edges per node, sorted by weight)
 *   - Weight-based edge selection
 */
export declare class GraphRepository {
    static getNodes(userId: string): Promise<{
        id: string;
        nodeType: string;
        content: string;
        createdAt: Date;
        metadata: unknown;
    }[]>;
    static getEdges(nodeIds: string[], userId: string): Promise<Record<string, unknown>[]>;
    /**
     * Depth-bounded recursive graph traversal from a seed node.
     *
     * Production constraints:
     *   - Maximum depth: 2 hops (prevents runaway recursion)
     *   - Cycle detection: PostgreSQL CYCLE clause prevents infinite loops
     *   - Supernode gating: At each hop, only the top 50 edges by weight are followed
     *   - Weight threshold: Only traverse edges with weight ≥ 0.2
     *
     * Returns all reachable nodes within 2 hops and their connecting edges.
     */
    static getNeighborhood(seedNodeId: string, userId: string, maxDepth?: number, maxEdgesPerNode?: number): Promise<Record<string, unknown>[]>;
    /**
     * Get edges between a set of nodes, with supernode protection.
     * Limits to top 15 edges per source node by weight.
     */
    static getEdgesBounded(nodeIds: string[], userId: string, maxEdgesPerSource?: number): Promise<Record<string, unknown>[]>;
}
//# sourceMappingURL=graph.repository.d.ts.map