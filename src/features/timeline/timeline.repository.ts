import { db } from '../../db/index.js';
import { nodes, edges } from '../../db/schema.js';
import { eq, and, desc, sql, cosineDistance, inArray } from 'drizzle-orm';

export class TimelineRepository {
  static async getRecentMemories(userId: string, limit = 50) {
    const memories = await db
      .select({
        id: nodes.id,
        nodeType: nodes.nodeType,
        content: nodes.content,
        metadata: nodes.metadata,
        createdAt: nodes.createdAt,
        updatedAt: nodes.updatedAt,
      })
      .from(nodes)
      .where(and(inArray(nodes.nodeType, ['memory', 'insight']), eq(nodes.userId, userId)))
      .orderBy(desc(nodes.updatedAt))
      .limit(limit);

    return memories;
  }

  static async getPendingMemories(userId: string, limit = 10) {
    const pendingEvents = await db.execute(sql`
      SELECT id, event_type, payload, processing_status, created_at
      FROM events
      WHERE user_id = ${userId}
      AND processing_status IN ('pending', 'processing', 'retrying')
      AND event_type IN ('memory_created', 'text', 'audio', 'image', 'url', 'pdf')
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return pendingEvents.rows;
  }

  static async getProjectForMemory(memoryId: string, userId: string) {
    const projectEdge = await db.execute(sql`
      SELECT n.content as project_name
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes s ON e.source_node_id = s.id
      WHERE e.source_node_id = ${memoryId}
      AND n.node_type = 'project'
      AND s.user_id = ${userId}
      AND n.user_id = ${userId}
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
    const mems = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, memoryId), eq(nodes.userId, userId), inArray(nodes.nodeType, ['memory', 'insight', 'raw_thought'])))
      .limit(1);
    return mems[0] || null;
  }

  static async getMemoryConnections(memoryId: string, userId: string) {
    const connections = await db.execute(sql`
      SELECT n.id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes s ON e.source_node_id = s.id
      WHERE e.source_node_id = ${memoryId}
      AND s.user_id = ${userId}
      AND n.user_id = ${userId}
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

  static async deleteMemory(memoryId: string, userId: string) {
    await db.delete(nodes).where(and(eq(nodes.id, memoryId), eq(nodes.userId, userId)));
  }
}
