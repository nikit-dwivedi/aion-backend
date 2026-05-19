import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges } from '../db/schema.ts';
import { eq, and, desc, sql, cosineDistance } from 'drizzle-orm';

const router = Router();

// GET /api/timeline - Returns chronological memories
router.get('/', async (req: Request, res: Response) => {
  try {
    const memories = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        metadata: nodes.metadata,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, (req as any).userId)))
      .orderBy(desc(nodes.createdAt))
      .limit(50);

    // For each memory, fetch its connected project
    const enriched = await Promise.all(memories.map(async (mem) => {
      const projectEdge = await db.execute(sql`
        SELECT n.content as project_name
        FROM edges e
        JOIN nodes n ON e.target_node_id = n.id
        WHERE e.source_node_id = ${mem.id}
        AND n.node_type = 'project'
        LIMIT 1
      `);

      const meta = mem.metadata as any;
      return {
        ...mem,
        project: projectEdge.rows[0]?.project_name || null,
        rawContent: meta?.rawContent || null,
        sentiment: meta?.sentiment || 'neutral',
        moodScore: meta?.moodScore || 5,
      };
    }));

    return res.json({ memories: enriched });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// GET /api/timeline/resurface - Memory resurfacing ("On this day")
router.get('/resurface', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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
    const memories = resurfaced.rows.map((r: any) => ({
      id: r.id, content: r.content, createdAt: r.created_at,
      daysAgo: Math.round((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));
    return res.json({ memories });
  } catch (error) {
    console.error('Error resurfacing memories:', error);
    return res.status(500).json({ error: 'Failed to resurface memories' });
  }
});

// GET /api/timeline/:id - Returns a single memory with full detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const memoryId = req.params.id;
    if (!memoryId) return res.status(400).json({ error: 'Missing id' });

    // 1. Fetch the memory node
    const [memory] = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, memoryId), eq(nodes.nodeType, 'memory')))
      .limit(1);

    if (!memory) return res.status(404).json({ error: 'Memory not found' });

    // 2. Fetch connected entities and project
    const connections = await db.execute(sql`
      SELECT n.id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      WHERE e.source_node_id = ${memoryId}
    `);

    const entities = connections.rows.filter(r => r.node_type === 'entity').map(r => r.content);
    const project = connections.rows.find(r => r.node_type === 'project')?.content || null;

    // 3. Find related memories via vector similarity
    let relatedMemories: any[] = [];
    if (memory.embedding) {
      const similar = await db
        .select({
          id: nodes.id,
          content: nodes.content,
          createdAt: nodes.createdAt,
          distance: cosineDistance(nodes.embedding, memory.embedding),
        })
        .from(nodes)
        .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, (req as any).userId)))
        .orderBy(cosineDistance(nodes.embedding, memory.embedding))
        .limit(4); // 1st is self

      relatedMemories = similar.filter(s => s.id !== memoryId).slice(0, 3);
    }

    const meta = memory.metadata as any;
    return res.json({
      memory: {
        id: memory.id,
        content: memory.content,
        rawContent: meta?.rawContent || memory.content,
        sentiment: meta?.sentiment || 'neutral',
        moodScore: meta?.moodScore || 5,
        project,
        entities,
        createdAt: memory.createdAt,
        relatedMemories,
      }
    });
  } catch (error) {
    console.error('Error fetching memory detail:', error);
    return res.status(500).json({ error: 'Failed to fetch memory detail' });
  }
});

// DELETE /api/timeline/:id - Delete a memory
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const memoryId = req.params.id;
    if (!memoryId) return res.status(400).json({ error: 'Missing id' });
    
    // Cascading delete handles edges since edges table has ON DELETE CASCADE
    await db.delete(nodes).where(eq(nodes.id, memoryId));

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    return res.status(500).json({ error: 'Failed to delete memory' });
  }
});

export default router;
