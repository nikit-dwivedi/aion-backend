import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges, events } from '../db/schema.ts';
import { eq, desc, sql } from 'drizzle-orm';

const router = Router();

// GET /api/analytics/focus - Focus analytics (when does user capture most?)
router.get('/focus', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // 1. Hourly distribution of captures
    const hourlyResult = await db.execute(sql`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      GROUP BY hour ORDER BY hour
    `);

    // 2. Day-of-week distribution
    const dowResult = await db.execute(sql`
      SELECT EXTRACT(DOW FROM created_at) as dow, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      GROUP BY dow ORDER BY dow
    `);

    // 3. Daily capture streak
    const streakResult = await db.execute(sql`
      WITH daily AS (
        SELECT DATE(created_at) as d
        FROM nodes
        WHERE node_type = 'memory' AND user_id = ${userId}
        GROUP BY DATE(created_at)
        ORDER BY d DESC
      )
      SELECT d FROM daily
    `);

    // Calculate current streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const row of streakResult.rows) {
      const d = new Date(row.d as string);
      d.setHours(0, 0, 0, 0);
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - streak);
      if (d.getTime() === expectedDate.getTime()) {
        streak++;
      } else if (streak === 0 && d.getTime() === new Date(today.getTime() - 86400000).getTime()) {
        // Allow yesterday if today hasn't had capture yet
        streak = 1;
      } else {
        break;
      }
    }

    // 4. Total stats
    const totalResult = await db.execute(sql`
      SELECT 
        COUNT(*)::int as total_memories,
        MIN(created_at) as first_capture,
        MAX(created_at) as last_capture
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
    `);

    // 5. Peak hour insight
    const hours = hourlyResult.rows as any[];
    const peakHour = hours.reduce((max, h) => (h.count > (max?.count ?? 0) ? h : max), null);
    const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dows = dowResult.rows as any[];
    const peakDow = dows.reduce((max, d) => (d.count > (max?.count ?? 0) ? d : max), null);

    return res.json({
      hourlyDistribution: hours.map(h => ({ hour: Number(h.hour), count: h.count })),
      dayOfWeekDistribution: dows.map(d => ({ day: dowNames[Number(d.dow)], count: d.count })),
      currentStreak: streak,
      peakHour: peakHour ? Number(peakHour.hour) : null,
      peakDay: peakDow ? dowNames[Number(peakDow.dow)] : null,
      totalMemories: totalResult.rows[0]?.total_memories ?? 0,
      firstCapture: totalResult.rows[0]?.first_capture ?? null,
      lastCapture: totalResult.rows[0]?.last_capture ?? null,
    });
  } catch (error) {
    console.error('Focus analytics error:', error);
    return res.status(500).json({ error: 'Failed to compute focus analytics' });
  }
});

// GET /api/analytics/patterns - Behavioral pattern detection
router.get('/patterns', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // 1. Most mentioned projects (recurring focus areas)
    const topProjects = await db.execute(sql`
      SELECT n.content as project, COUNT(*)::int as mention_count
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'project' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mention_count DESC
      LIMIT 5
    `);

    // 2. Most mentioned entities (recurring topics)
    const topEntities = await db.execute(sql`
      SELECT n.content as entity, COUNT(*)::int as mention_count
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'entity' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mention_count DESC
      LIMIT 10
    `);

    // 3. Sentiment trend (last 30 days, weekly buckets)
    const sentimentTrend = await db.execute(sql`
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

    // 4. Capture frequency trend (daily counts over last 30 days)
    const captureTrend = await db.execute(sql`
      SELECT DATE(created_at) as date, COUNT(*)::int as count
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);

    // 5. Detect "recurring concerns" - entities that appear with negative sentiment
    const concerns = await db.execute(sql`
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

    // 6. People mentioned (person entities)
    const people = await db.execute(sql`
      SELECT n.content as person, COUNT(*)::int as mentions
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      JOIN nodes m ON e.source_node_id = m.id
      WHERE n.node_type = 'person' AND m.user_id = ${userId}
      GROUP BY n.content
      ORDER BY mentions DESC
      LIMIT 10
    `);

    return res.json({
      topProjects: topProjects.rows,
      topEntities: topEntities.rows,
      sentimentTrend: sentimentTrend.rows,
      captureTrend: captureTrend.rows,
      recurringConcerns: concerns.rows,
      people: people.rows,
    });
  } catch (error) {
    console.error('Behavioral patterns error:', error);
    return res.status(500).json({ error: 'Failed to compute patterns' });
  }
});

export default router;
