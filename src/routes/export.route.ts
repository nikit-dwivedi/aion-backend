import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges } from '../db/schema.ts';
import { eq, sql } from 'drizzle-orm';

const router = Router();

// GET /api/export - Export all user data as JSON
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const allNodes = await db
      .select()
      .from(nodes)
      .where(eq(nodes.userId, userId));

    const nodeIds = allNodes.map(n => n.id);
    let allEdges: any[] = [];
    if (nodeIds.length > 0) {
      const { rows } = await db.execute(sql`
        SELECT * FROM edges 
        WHERE source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
      `);
      allEdges = rows;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      nodes: allNodes.map(n => ({
        id: n.id,
        type: n.nodeType,
        content: n.content,
        metadata: n.metadata,
        createdAt: n.createdAt,
      })),
      edges: allEdges.map((e: any) => ({
        source: e.source_node_id,
        target: e.target_node_id,
        relation: e.relation_type,
        weight: e.weight,
      })),
      stats: {
        totalNodes: allNodes.length,
        totalEdges: allEdges.length,
        memories: allNodes.filter(n => n.nodeType === 'memory').length,
        projects: allNodes.filter(n => n.nodeType === 'project').length,
        entities: allNodes.filter(n => n.nodeType === 'entity').length,
      },
    };

    res.setHeader('Content-Disposition', 'attachment; filename="aion-export.json"');
    return res.json(exportData);
  } catch (error) {
    console.error('Error exporting data:', error);
    return res.status(500).json({ error: 'Failed to export data' });
  }
});

export default router;
