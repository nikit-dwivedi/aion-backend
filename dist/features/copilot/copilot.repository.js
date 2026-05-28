import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
export class CopilotRepository {
    static async getRecentMemories(userId, limit = 30) {
        return await db.select({
            id: nodes.id,
            content: nodes.content,
            createdAt: nodes.createdAt
        }).from(nodes).where(sql `${nodes.nodeType} = 'memory' AND ${nodes.userId} = ${userId}`).orderBy(desc(nodes.createdAt)).limit(limit);
    }
    static async getAllProjects(userId) {
        return await db.select({ content: nodes.content }).from(nodes).where(sql `${nodes.nodeType} = 'project' AND ${nodes.userId} = ${userId}`);
    }
    static async insertInsight(userId, insight) {
        await db.insert(nodes).values({
            userId,
            nodeType: 'insight',
            content: JSON.stringify(insight),
            metadata: { generatedAt: new Date().toISOString(), type: insight.type }
        });
    }
    static async getInsights(userId, limit = 20) {
        return await db.select({
            id: nodes.id,
            content: nodes.content,
            createdAt: nodes.createdAt
        }).from(nodes).where(sql `${nodes.nodeType} = 'insight' AND ${nodes.userId} = ${userId}`).orderBy(desc(nodes.createdAt)).limit(limit);
    }
}
//# sourceMappingURL=copilot.repository.js.map