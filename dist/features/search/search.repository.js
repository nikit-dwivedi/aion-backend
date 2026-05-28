import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { cosineDistance, eq, sql, and } from 'drizzle-orm';
export class SearchRepository {
    static async findSimilarMemories(queryEmbedding, userId, limit = 5) {
        return await db
            .select({
            id: nodes.id,
            content: nodes.content,
            distance: cosineDistance(nodes.embedding, queryEmbedding),
        })
            .from(nodes)
            .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, userId)))
            .orderBy(cosineDistance(nodes.embedding, queryEmbedding))
            .limit(limit);
    }
    static async getMemoryConnections(memoryNodeIds, userId) {
        if (memoryNodeIds.length === 0)
            return { rows: [] };
        return await db.execute(sql `
      SELECT e.source_node_id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes s ON e.source_node_id = s.id
      WHERE e.source_node_id = ANY(ARRAY[${sql.join(memoryNodeIds, sql `, `)}]::uuid[])
      AND n.user_id = ${userId}
      AND s.user_id = ${userId}
    `);
    }
}
//# sourceMappingURL=search.repository.js.map