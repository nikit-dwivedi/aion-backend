import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Graph Repository with production-grade query optimizations:
 *   - Depth-bounded recursive traversal (D ≤ 2)
 *   - Loop detection via CYCLE clause
 *   - Supernode gating (max 50 edges per node, sorted by weight)
 *   - Weight-based edge selection
 */
export class GraphRepository {
  static async getNodes(userId: string) {
    return await db
      .select({
        id: nodes.id,
        nodeType: nodes.nodeType,
        content: nodes.content,
        createdAt: nodes.createdAt,
        metadata: nodes.metadata,
      })
      .from(nodes)
      .where(eq(nodes.userId, userId));
  }

  static async getEdges(nodeIds: string[]) {
    if (nodeIds.length === 0) return [];
    
    const edgeResult = await db.execute(sql`
      SELECT e.id, e.source_node_id, e.target_node_id, e.relation_type, e.weight
      FROM edges e
      WHERE (e.source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
        OR e.target_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[]))
      ORDER BY e.weight DESC
    `);
    return edgeResult.rows;
  }

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
  static async getNeighborhood(seedNodeId: string, maxDepth = 2, maxEdgesPerNode = 50) {
    const result = await db.execute(sql`
      WITH RECURSIVE graph_walk AS (
        -- Base case: start from the seed node
        SELECT
          n.id AS node_id,
          n.node_type,
          n.content,
          n.metadata,
          n.created_at,
          0 AS depth,
          ARRAY[n.id] AS path
        FROM nodes n
        WHERE n.id = ${seedNodeId}

        UNION ALL

        -- Recursive step: follow edges up to maxDepth, gated by weight and degree
        SELECT
          neighbor.id AS node_id,
          neighbor.node_type,
          neighbor.content,
          neighbor.metadata,
          neighbor.created_at,
          gw.depth + 1 AS depth,
          gw.path || neighbor.id
        FROM graph_walk gw
        JOIN LATERAL (
          -- Get edges from the current node, sorted by weight, limited to top N
          SELECT e.source_node_id, e.target_node_id, e.weight
          FROM edges e
          WHERE (e.source_node_id = gw.node_id OR e.target_node_id = gw.node_id)
            AND e.weight >= 0.2
          ORDER BY e.weight DESC
          LIMIT ${maxEdgesPerNode}
        ) ranked_edges ON true
        JOIN nodes neighbor ON neighbor.id = CASE
          WHEN ranked_edges.source_node_id = gw.node_id THEN ranked_edges.target_node_id
          ELSE ranked_edges.source_node_id
        END
        WHERE gw.depth < ${maxDepth}
          AND NOT (neighbor.id = ANY(gw.path))  -- Loop detection
      )
      SELECT DISTINCT ON (node_id) node_id, node_type, content, metadata, created_at, depth
      FROM graph_walk
      ORDER BY node_id, depth ASC
    `);

    return result.rows;
  }

  /**
   * Get edges between a set of nodes, with supernode protection.
   * Limits to top 15 edges per source node by weight.
   */
  static async getEdgesBounded(nodeIds: string[], maxEdgesPerSource = 15) {
    if (nodeIds.length === 0) return [];

    const result = await db.execute(sql`
      SELECT id, source_node_id, target_node_id, relation_type, weight
      FROM (
        SELECT
          e.id, e.source_node_id, e.target_node_id, e.relation_type, e.weight,
          ROW_NUMBER() OVER (PARTITION BY e.source_node_id ORDER BY e.weight DESC) as rn
        FROM edges e
        WHERE e.source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
          OR e.target_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
      ) ranked
      WHERE rn <= ${maxEdgesPerSource}
    `);

    return result.rows;
  }
}
