import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges } from '../db/schema.ts';
import { eq, and, desc, sql } from 'drizzle-orm';

const router = Router();

// GET /api/projects - Returns all projects with their linked memories
router.get('/', async (req: Request, res: Response) => {
  try {
    const projects = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'project'), eq(nodes.userId, (req as any).userId)))
      .orderBy(desc(nodes.createdAt));

    // For each project, fetch linked memories
    const enriched = await Promise.all(projects.map(async (proj) => {
      const linkedMemories = await db.execute(sql`
        SELECT n.id, n.content, n.created_at
        FROM edges e
        JOIN nodes n ON e.source_node_id = n.id
        WHERE e.target_node_id = ${proj.id}
        AND n.node_type = 'memory'
        AND e.relation_type = 'belongs_to'
        ORDER BY n.created_at DESC
        LIMIT 20
      `);

      // Fetch linked entities
      const linkedEntities = await db.execute(sql`
        SELECT DISTINCT n2.content
        FROM edges e1
        JOIN nodes mem ON e1.source_node_id = mem.id
        JOIN edges e2 ON e2.source_node_id = mem.id
        JOIN nodes n2 ON e2.target_node_id = n2.id
        WHERE e1.target_node_id = ${proj.id}
        AND e1.relation_type = 'belongs_to'
        AND n2.node_type = 'entity'
        LIMIT 10
      `);

      return {
        ...proj,
        memoryCount: linkedMemories.rows.length,
        memories: linkedMemories.rows,
        entities: linkedEntities.rows.map((r: any) => r.content),
      };
    }));

    return res.json({ projects: enriched });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// PATCH /api/projects/move - Move a memory to a different project
router.patch('/move', async (req: Request, res: Response) => {
  try {
    const { memoryId, newProjectName, userId = '123e4567-e89b-12d3-a456-426614174000' } = req.body;
    if (!memoryId || !newProjectName) {
      return res.status(400).json({ error: 'Missing memoryId or newProjectName' });
    }

    await db.transaction(async (tx) => {
      // 1. Delete existing project edge for this memory
      // We assume only one project link per memory for simplicity, or we delete all project links.
      const existingProjectEdges = await tx.execute(sql`
        SELECT e.id FROM edges e
        JOIN nodes n ON e.target_node_id = n.id
        WHERE e.source_node_id = ${memoryId} AND n.node_type = 'project'
      `);
      
      for (const row of existingProjectEdges.rows) {
        await tx.delete(edges).where(eq(edges.id, row.id as string));
      }

      // 2. Find or Create the new project node
      const existingProj = await tx.execute(sql`
        SELECT id FROM nodes 
        WHERE node_type = 'project' AND lower(content) = lower(${newProjectName})
        LIMIT 1
      `);
      
      let newProjId: string;
      if (existingProj?.rows?.length > 0) {
        newProjId = existingProj?.rows[0]?.id as string;
      } else {
        const [insertedProj] = await tx.insert(nodes).values({
          userId,
          nodeType: 'project',
          content: newProjectName
        }).returning();
        if (!insertedProj) {
          throw new Error('Failed to create project');
        }
        newProjId = insertedProj.id;
      }

      // 3. Create the new edge
      await tx.insert(edges).values({
        sourceNodeId: memoryId,
        targetNodeId: newProjId,
        relationType: 'belongs_to',
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error moving project:', error);
    return res.status(500).json({ error: 'Failed to move memory to new project' });
  }
});

export default router;
