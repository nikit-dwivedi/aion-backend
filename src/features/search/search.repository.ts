import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { cosineDistance, eq, sql } from 'drizzle-orm';

export class SearchRepository {
  static async findSimilarMemories(queryEmbedding: number[], limit = 5) {
    return await db
      .select({
        id: nodes.id,
        content: nodes.content,
        distance: cosineDistance(nodes.embedding, queryEmbedding),
      })
      .from(nodes)
      .where(eq(nodes.nodeType, 'memory'))
      .orderBy(cosineDistance(nodes.embedding, queryEmbedding))
      .limit(limit);
  }

  static async getMemoryConnections(memoryNodeIds: string[]) {
    return await db.execute(sql`
      SELECT e.source_node_id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      WHERE e.source_node_id = ANY(ARRAY[${sql.join(memoryNodeIds, sql`, `)}]::uuid[])
    `);
  }
}
