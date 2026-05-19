import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export class CopilotRepository {
  static async getRecentMemories(limit = 30) {
    return await db.select({
      id: nodes.id,
      content: nodes.content,
      createdAt: nodes.createdAt
    }).from(nodes).where(eq(nodes.nodeType, 'memory')).orderBy(desc(nodes.createdAt)).limit(limit);
  }

  static async getAllProjects() {
    return await db.select({ content: nodes.content }).from(nodes).where(eq(nodes.nodeType, 'project'));
  }

  static async insertInsight(userId: string, insight: any) {
    await db.insert(nodes).values({
      userId,
      nodeType: 'insight',
      content: JSON.stringify(insight),
      metadata: { generatedAt: new Date().toISOString(), type: insight.type }
    });
  }

  static async getInsights(limit = 20) {
    return await db.select({
      id: nodes.id,
      content: nodes.content,
      createdAt: nodes.createdAt
    }).from(nodes).where(eq(nodes.nodeType, 'insight')).orderBy(desc(nodes.createdAt)).limit(limit);
  }
}
