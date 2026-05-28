import { db } from '../../db/index.js';
import { nodes, edges } from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';

export class PlanningRepository {
  static async resolveNode(userId: string, nodeType: string, content: string, tx: any = db) {
    const existing = await tx.execute(sql`
      SELECT id FROM nodes 
      WHERE node_type = ${nodeType} AND user_id = ${userId} AND lower(content) = lower(${content})
      LIMIT 1
    `);
    
    if (existing?.rows?.length > 0) {
      return existing.rows[0].id as string;
    }
    
    const [newNode] = await tx.insert(nodes).values({
      userId,
      nodeType,
      content
    }).returning();
    
    return newNode.id;
  }

  static async getActiveProjects(userId: string) {
    return await db.select({ content: nodes.content }).from(nodes).where(and(eq(nodes.nodeType, 'project'), eq(nodes.userId, userId)));
  }

  static async saveGoalBreakdown(userId: string, breakdown: any) {
    await db.transaction(async (tx) => {
      const [goalNode] = await tx.insert(nodes).values({
        userId,
        nodeType: 'goal',
        content: breakdown.goalName,
        metadata: { status: 'active' }
      }).returning();

      if (!goalNode?.id) throw new Error('Failed to create goal node');

      if (breakdown.relatedProject) {
        const projectId = await PlanningRepository.resolveNode(userId, 'project', breakdown.relatedProject, tx);
        await tx.insert(edges).values({
          sourceNodeId: goalNode.id,
          targetNodeId: projectId,
          relationType: 'belongs_to',
        });
      }

      let previousTaskId = null;
      for (const step of breakdown.steps) {
        const [taskNode] = await tx.insert(nodes).values({
          userId,
          nodeType: 'task',
          content: step,
          metadata: { status: 'pending' }
        }).returning();

        if (!taskNode?.id) throw new Error('Failed to create task node');

        await tx.insert(edges).values({
          sourceNodeId: taskNode.id,
          targetNodeId: goalNode.id,
          relationType: 'belongs_to',
        });

        if (previousTaskId) {
          await tx.insert(edges).values({
            sourceNodeId: previousTaskId,
            targetNodeId: taskNode.id,
            relationType: 'blocks',
          });
        }
        previousTaskId = taskNode.id;
      }
    });
  }

  static async getActiveTasks(userId: string) {
    return await db.execute(sql`
      SELECT t.content as task, g.content as goal
      FROM nodes t
      JOIN edges e ON e.source_node_id = t.id
      JOIN nodes g ON e.target_node_id = g.id
      WHERE t.node_type = 'task' AND g.node_type = 'goal'
      AND t.user_id = ${userId}
      AND g.user_id = ${userId}
      LIMIT 10
    `);
  }

  static async getRecentInsights(userId: string) {
    return await db
      .select({ content: nodes.content })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'insight'), eq(nodes.userId, userId)))
      .orderBy(desc(nodes.createdAt))
      .limit(5);
  }
}
