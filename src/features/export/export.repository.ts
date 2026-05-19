import { db } from '../../db/index.js';
import { nodes } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export class ExportRepository {
  static async getAllNodes(userId: string) {
    return await db.select().from(nodes).where(eq(nodes.userId, userId));
  }

  static async getAllEdges(nodeIds: string[]) {
    if (nodeIds.length === 0) return [];
    const { rows } = await db.execute(sql`
      SELECT * FROM edges 
      WHERE source_node_id = ANY(ARRAY[${sql.join(nodeIds, sql`, `)}]::uuid[])
    `);
    return rows;
  }
}
