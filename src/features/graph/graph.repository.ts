import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export class GraphRepository {
  static async getNodes(userId: string) {
    return await db
      .select({
        id: nodes.id,
        nodeType: nodes.nodeType,
        content: nodes.content,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(eq(nodes.userId, userId));
  }

  static async getEdges(nodeIds: string[]) {
    if (nodeIds.length === 0) return [];
    
    const edgeResult = await db.execute(sql`
      SELECT e.id, e.source_node_id, e.target_node_id, e.relation_type, e.weight
      FROM edges e
      WHERE e.source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
      OR e.target_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
    `);
    return edgeResult.rows;
  }
}
