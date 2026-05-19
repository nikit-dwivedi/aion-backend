import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges } from '../db/schema.ts';
import { eq, sql } from 'drizzle-orm';

const router = Router();

// GET /api/graph - Returns full cognitive graph for the user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // 1. Fetch all nodes for user
    const allNodes = await db
      .select({
        id: nodes.id,
        nodeType: nodes.nodeType,
        content: nodes.content,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(eq(nodes.userId, userId));

    // 2. Fetch all edges between user's nodes
    const nodeIds = allNodes.map(n => n.id);
    
    let allEdges: any[] = [];
    if (nodeIds.length > 0) {
      const edgeResult = await db.execute(sql`
        SELECT e.id, e.source_node_id, e.target_node_id, e.relation_type, e.weight
        FROM edges e
        WHERE e.source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
        OR e.target_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
      `);
      allEdges = edgeResult.rows;
    }

    // 3. Format response
    const graphNodes = allNodes.map(n => ({
      id: n.id,
      type: n.nodeType,
      label: n.content.length > 50 ? n.content.substring(0, 50) + '...' : n.content,
      content: n.content,
    }));

    const graphEdges = allEdges.map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      relation: e.relation_type,
      weight: e.weight,
    }));

    return res.json({ nodes: graphNodes, edges: graphEdges });
  } catch (error) {
    console.error('Error fetching graph:', error);
    return res.status(500).json({ error: 'Failed to fetch graph' });
  }
});

export default router;
