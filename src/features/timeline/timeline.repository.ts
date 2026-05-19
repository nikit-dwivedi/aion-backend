import { db } from '../../db/index.js';
import { nodes, edges } from '../../db/schema.js';
import { eq, and, desc, sql, cosineDistance } from 'drizzle-orm';

export class TimelineRepository {
  static async getRecentMemories(userId: string, limit = 50) {
    const memories = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        metadata: nodes.metadata,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, userId)))
      .orderBy(desc(nodes.createdAt))
      .limit(limit);

    return memories;
  }

  static async getProjectForMemory(memoryId: string) {
    const projectEdge = await db.execute(sql`
      SELECT n.content as project_name
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      WHERE e.source_node_id = ${memoryId}
      AND n.node_type = 'project'
      LIMIT 1
    `);
    return (projectEdge.rows[0] as any)?.project_name || null;
  }

  static async getResurfacedMemories(userId: string) {
    const resurfaced = await db.execute(sql`
      SELECT id, content, created_at, metadata
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      AND (
        (created_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '6 days')
        OR (created_at BETWEEN NOW() - INTERVAL '31 days' AND NOW() - INTERVAL '29 days')
        OR (created_at BETWEEN NOW() - INTERVAL '91 days' AND NOW() - INTERVAL '89 days')
      )
      ORDER BY created_at DESC LIMIT 5
    `);
    return resurfaced.rows;
  }

  static async getMemoryById(userId: string, memoryId: string) {
    const [memory] = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, memoryId), eq(nodes.nodeType, 'memory'), eq(nodes.userId, userId)))
      .limit(1);
    return memory;
  }

  static async getMemoryConnections(memoryId: string) {
    const connections = await db.execute(sql`
      SELECT n.id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      WHERE e.source_node_id = ${memoryId}
    `);
    return connections.rows;
  }

  static async getSimilarMemories(userId: string, memoryId: string, embedding: number[]) {
    const similar = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        createdAt: nodes.createdAt,
        distance: cosineDistance(nodes.embedding, embedding),
      })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, userId)))
      .orderBy(cosineDistance(nodes.embedding, embedding))
      .limit(4);
    
    return similar.filter(s => s.id !== memoryId).slice(0, 3);
  }

  static async deleteMemory(memoryId: string) {
    await db.delete(nodes).where(eq(nodes.id, memoryId));
  }
}
