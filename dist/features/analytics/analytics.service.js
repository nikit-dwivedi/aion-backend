import { AnalyticsRepository } from './analytics.repository.js';
import { llm } from '../../services/llm.service.js';
import { env } from '../../config/env.js';
import { cleanAndParseJson } from '../../core/utils.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
export class AnalyticsService {
    static async getFocusAnalytics(userId) {
        const hourlyResult = await AnalyticsRepository.getHourlyDistribution(userId);
        const dowResult = await AnalyticsRepository.getDowDistribution(userId);
        const streakResult = await AnalyticsRepository.getDailyStreak(userId);
        const totalResult = await AnalyticsRepository.getTotalStats(userId);
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const row of streakResult.rows) {
            const d = new Date(row.d);
            d.setHours(0, 0, 0, 0);
            const expectedDate = new Date(today);
            expectedDate.setDate(expectedDate.getDate() - streak);
            if (d.getTime() === expectedDate.getTime()) {
                streak++;
            }
            else if (streak === 0 && d.getTime() === new Date(today.getTime() - 86400000).getTime()) {
                streak = 1;
            }
            else {
                break;
            }
        }
        const hours = hourlyResult.rows;
        const peakHour = hours.reduce((max, h) => (h.count > (max?.count ?? 0) ? h : max), null);
        const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dows = dowResult.rows;
        const peakDow = dows.reduce((max, d) => (d.count > (max?.count ?? 0) ? d : max), null);
        return {
            hourlyDistribution: hours.map(h => ({ hour: Number(h.hour), count: h.count })),
            dayOfWeekDistribution: dows.map(d => ({ day: dowNames[Number(d.dow)], count: d.count })),
            currentStreak: streak,
            peakHour: peakHour ? Number(peakHour.hour) : null,
            peakDay: peakDow ? dowNames[Number(peakDow.dow)] : null,
            totalMemories: totalResult.rows[0]?.total_memories ?? 0,
            firstCapture: totalResult.rows[0]?.first_capture ?? null,
            lastCapture: totalResult.rows[0]?.last_capture ?? null,
        };
    }
    static async getBehavioralPatterns(userId) {
        const topProjects = await AnalyticsRepository.getTopProjects(userId);
        const topEntities = await AnalyticsRepository.getTopEntities(userId);
        const sentimentTrend = await AnalyticsRepository.getSentimentTrend(userId);
        const captureTrend = await AnalyticsRepository.getCaptureTrend(userId);
        const concerns = await AnalyticsRepository.getRecurringConcerns(userId);
        const people = await AnalyticsRepository.getPeople(userId);
        return {
            topProjects: topProjects.rows,
            topEntities: topEntities.rows,
            sentimentTrend: sentimentTrend.rows,
            captureTrend: captureTrend.rows,
            recurringConcerns: concerns.rows,
            people: people.rows,
        };
    }
    static async getForecast(userId) {
        if (!llm.isConfigured)
            return null;
        const sentimentTrend = await AnalyticsRepository.getSentimentTrend(userId);
        const captureTrend = await AnalyticsRepository.getCaptureTrend(userId);
        const sentimentStr = JSON.stringify(sentimentTrend.rows);
        const captureStr = JSON.stringify(captureTrend.rows);
        const prompt = `You are AION's predictive engine. 
Analyze the user's past 30 days of activity:
Sentiment Trend: ${sentimentStr}
Capture Trend: ${captureStr}

Generate a short 7-day "Cognitive Forecast". 
Return JSON with exactly these fields:
- title: A short title (e.g. "Creative Surge Expected", "Risk of Burnout")
- forecast: A 2-sentence prediction of their cognitive state or focus.
- recommendation: A 1-sentence actionable advice.
Output ONLY raw JSON.`;
        try {
            const aiResponse = await llm.generateContent({ prompt });
            return cleanAndParseJson(aiResponse);
        }
        catch {
            return null;
        }
    }
    static async getCognitionDashboard(userId) {
        // 1. Avg Latency for event completions
        const latencyRes = await db.execute(sql `
      SELECT event_type, 
             COUNT(*)::int as count,
             AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::double precision as avg_latency
      FROM events
      WHERE user_id = ${userId}
      AND processing_status = 'completed'
      AND event_type IN ('memory_created', 'plan_update_requested', 'research_requested')
      GROUP BY event_type
    `);
        // 2. Global Event Stats
        const statsRes = await db.execute(sql `
      SELECT 
        SUM(CASE WHEN processing_status = 'dead_lettered' THEN 1 ELSE 0 END)::int as dlq_count,
        SUM(retry_count)::int as total_retries,
        SUM(token_usage)::int as total_tokens,
        SUM(estimated_cost)::double precision as total_cost,
        COUNT(*)::int as total_events
      FROM events
      WHERE user_id = ${userId}
    `);
        // 3. Reinforcement count
        const reinforceRes = await db.execute(sql `
      SELECT COUNT(*)::int as count
      FROM events
      WHERE user_id = ${userId}
      AND event_type = 'memory_reinforced'
    `);
        // 4. Notification Suppression Ratio
        const notificationsCountRes = await db.execute(sql `
      SELECT COUNT(*)::int as count FROM notifications WHERE user_id = ${userId}
    `);
        const notifRequestsRes = await db.execute(sql `
      SELECT COUNT(*)::int as count FROM events 
      WHERE user_id = ${userId} 
      AND event_type = 'push_notification_requested'
    `);
        const sentNotifs = Number(notificationsCountRes.rows[0]?.count || 0);
        const requestedNotifs = Number(notifRequestsRes.rows[0]?.count || 0);
        const suppressedRate = requestedNotifs > 0 ? Math.max(0, 1 - (sentNotifs / requestedNotifs)) : 0.0;
        // 5. Retrieval Success Rate (helpful/clicked vs total logs)
        const retrievalRes = await db.execute(sql `
      SELECT 
        COUNT(*)::int as total,
        SUM(CASE WHEN feedback_state IN ('clicked', 'helpful', 'followed_up') THEN 1 ELSE 0 END)::int as successful
      FROM retrieval_logs
      WHERE user_id = ${userId}
    `);
        const totalRetrievals = Number(retrievalRes.rows[0]?.total || 0);
        const successfulRetrievals = Number(retrievalRes.rows[0]?.successful || 0);
        const retrievalSuccessRate = totalRetrievals > 0 ? (successfulRetrievals / totalRetrievals) : 1.0;
        const metrics = {};
        let totalLatency = 0;
        let latencyCount = 0;
        for (const row of latencyRes.rows) {
            const et = row.event_type;
            const count = row.count;
            const avg = Number(row.avg_latency || 0);
            metrics[et] = {
                avgLatency: Number(avg.toFixed(2)),
                count
            };
            totalLatency += avg * count;
            latencyCount += count;
        }
        const avgQueueLatency = latencyCount > 0 ? Number((totalLatency / latencyCount).toFixed(2)) : 0.0;
        const stats = statsRes.rows[0];
        return {
            queueLatencySeconds: avgQueueLatency,
            llmTokenUsage: stats?.total_tokens || 0,
            estimatedInferenceCost: Number((stats?.total_cost || 0.0).toFixed(5)),
            retryCount: stats?.total_retries || 0,
            deadLetterCount: stats?.dlq_count || 0,
            reinforcementCount: Number(reinforceRes.rows[0]?.count || 0),
            notificationSuppressionRate: Number(suppressedRate.toFixed(2)),
            retrievalSuccessRate: Number(retrievalSuccessRate.toFixed(2)),
            metrics
        };
    }
}
//# sourceMappingURL=analytics.service.js.map