import { db } from '../../db/index.js';
import { nodes, edges } from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
export class ProjectsRepository {
    static async getProjects(userId) {
        return await db
            .select({ id: nodes.id, content: nodes.content, createdAt: nodes.createdAt })
            .from(nodes)
            .where(and(eq(nodes.nodeType, 'project'), eq(nodes.userId, userId)))
            .orderBy(desc(nodes.createdAt));
    }
    static async getLinkedMemories(projectId, userId) {
        return await db.execute(sql `
      SELECT n.id, n.content, n.created_at
      FROM edges e
      JOIN nodes n ON e.source_node_id = n.id
      WHERE e.target_node_id = ${projectId}
      AND n.node_type = 'memory'
      AND e.relation_type = 'belongs_to'
      AND n.user_id = ${userId}
      ORDER BY n.created_at DESC
      LIMIT 20
    `);
    }
    static async getLinkedEntities(projectId, userId) {
        return await db.execute(sql `
      SELECT DISTINCT n2.content
      FROM edges e1
      JOIN nodes mem ON e1.source_node_id = mem.id
      JOIN edges e2 ON e2.source_node_id = mem.id
      JOIN nodes n2 ON e2.target_node_id = n2.id
      WHERE e1.target_node_id = ${projectId}
      AND e1.relation_type = 'belongs_to'
      AND n2.node_type = 'entity'
      AND mem.user_id = ${userId}
      AND n2.user_id = ${userId}
      LIMIT 10
    `);
    }
    static async moveMemoryToProject(memoryId, newProjectName, userId) {
        await db.transaction(async (tx) => {
            // 1. Verify memory node ownership
            const memoryCheck = await tx.execute(sql `
        SELECT id FROM nodes WHERE id = ${memoryId} AND user_id = ${userId} AND node_type = 'memory'
      `);
            if (memoryCheck.rows.length === 0)
                throw new Error('Memory not found or access denied');
            const existingProjectEdges = await tx.execute(sql `
        SELECT e.id FROM edges e
        JOIN nodes n ON e.target_node_id = n.id
        WHERE e.source_node_id = ${memoryId} AND n.node_type = 'project'
      `);
            for (const row of existingProjectEdges.rows) {
                await tx.delete(edges).where(eq(edges.id, row.id));
            }
            const existingProj = await tx.execute(sql `
        SELECT id FROM nodes 
        WHERE node_type = 'project' AND user_id = ${userId} AND lower(content) = lower(${newProjectName})
        LIMIT 1
      `);
            let newProjId;
            if (existingProj?.rows?.length > 0) {
                newProjId = existingProj?.rows[0]?.id;
            }
            else {
                const [insertedProj] = await tx.insert(nodes).values({
                    userId,
                    nodeType: 'project',
                    content: newProjectName
                }).returning();
                if (!insertedProj)
                    throw new Error('Failed to create project');
                newProjId = insertedProj.id;
            }
            await tx.insert(edges).values({
                sourceNodeId: memoryId,
                targetNodeId: newProjId,
                relationType: 'belongs_to',
            });
        });
    }
}
//# sourceMappingURL=projects.repository.js.map