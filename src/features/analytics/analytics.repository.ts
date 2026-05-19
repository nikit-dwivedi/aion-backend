import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';

export class AnalyticsRepository {
  static async getHourlyDistribution(userId: string) {
    return await db.execute(sql`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      GROUP BY hour ORDER BY hour
    `);
  }

  static async getDowDistribution(userId: string) {
    return await db.execute(sql`
      SELECT EXTRACT(DOW FROM created_at) as dow, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      GROUP BY dow ORDER BY dow
    `);
  }

  static async getDailyStreak(userId: string) {
    return await db.execute(sql`
      WITH daily AS (
        SELECT DATE(created_at) as d
        FROM nodes
        WHERE node_type = 'memory' AND user_id = ${userId}
        GROUP BY DATE(created_at)
        ORDER BY d DESC
      )
      SELECT d FROM daily
    `);
  }

  static async getTotalStats(userId: string) {
    return await db.execute(sql`
      SELECT 
        COUNT(*)::int as total_memories,
        MIN(created_at) as first_capture,
        MAX(created_at) as last_capture
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
    `);
  }

  static async getTopProjects(userId: string) {
    return await db.execute(sql`
      SELECT n.content as project, COUNT(*)::int as mention_count
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'project' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mention_count DESC
      LIMIT 5
    `);
  }

  static async getTopEntities(userId: string) {
    return await db.execute(sql`
      SELECT n.content as entity, COUNT(*)::int as mention_count
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'entity' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mention_count DESC
      LIMIT 10
    `);
  }

  static async getSentimentTrend(userId: string) {
    return await db.execute(sql`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        AVG((metadata->>'moodScore')::numeric)::numeric(3,1) as avg_mood,
        COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
        AND metadata->>'moodScore' IS NOT NULL
        AND created_at > NOW() - INTERVAL '90 days'
      GROUP BY week ORDER BY week
    `);
  }

  static async getCaptureTrend(userId: string) {
    return await db.execute(sql`
      SELECT DATE(created_at) as date, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);
  }

  static async getRecurringConcerns(userId: string) {
    return await db.execute(sql`
      SELECT n2.content as topic, COUNT(*)::int as occurrences
      FROM nodes n
      JOIN edges e ON e.source_node_id = n.id
      JOIN nodes n2 ON e.target_node_id = n2.id
      WHERE n.node_type = 'memory' AND n.user_id = ${userId}
        AND n2.node_type = 'entity'
        AND (n.metadata->>'sentiment' IN ('negative', 'anxious'))
      GROUP BY n2.content
      HAVING COUNT(*) >= 2
      ORDER BY occurrences DESC
      LIMIT 5
    `);
  }

  static async getPeople(userId: string) {
    return await db.execute(sql`
      SELECT n.content as person, COUNT(*)::int as mentions
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'person' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mentions DESC
      LIMIT 10
    `);
  }
}
