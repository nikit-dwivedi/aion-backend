import { db } from '../../db/index.js';
import { events } from '../../db/schema.js';

export class CaptureRepository {
  static async insertMemoryEvent(userId: string, payload: any) {
    const [event] = await db.insert(events).values({
      userId,
      eventType: 'memory_created',
      payload
    }).returning();
    return event;
  }
  static async retryEvent(userId: string, eventId: string) {
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(sql`
      UPDATE events
      SET processing_status = 'pending',
          retry_count = 0,
          last_error = NULL
      WHERE id = ${eventId} AND user_id = ${userId}
      RETURNING *
    `);
    
    if (result.rows.length === 0) {
      throw new Error('Event not found or not owned by user');
    }
    
    return result.rows[0];
  }
}
