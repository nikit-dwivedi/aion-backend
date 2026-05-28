import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { insertEvent } from '../core/events.js';
export function startEpisodeScheduler() {
    console.log('[EpisodeScheduler] Starting Episode Scheduler...');
    // Cycle every 12 hours
    setInterval(async () => {
        try {
            await enqueueEpisodeTasks();
        }
        catch (err) {
            console.error('[EpisodeScheduler] Error enqueuing tasks:', err);
        }
    }, 12 * 60 * 60 * 1000);
    // Proactive run after 40 seconds on startup
    setTimeout(async () => {
        try {
            console.log('[EpisodeScheduler] Running initial task enqueuing...');
            await enqueueEpisodeTasks();
        }
        catch (err) {
            console.error('[EpisodeScheduler] Startup enqueuing failed:', err);
        }
    }, 40000);
}
async function enqueueEpisodeTasks() {
    const allUsers = await db.select({ id: users.id }).from(users);
    for (const user of allUsers) {
        const existing = await db.execute(sql `
      SELECT id FROM events
      WHERE user_id = ${user.id}
      AND event_type = 'episodic_clustering_requested'
      AND processing_status IN ('pending', 'processing', 'retrying')
      LIMIT 1
    `);
        if (existing.rows.length === 0) {
            await insertEvent(db, {
                userId: user.id,
                eventType: 'episodic_clustering_requested',
                payload: {},
                priority: 'background',
            });
            console.log(`[EpisodeScheduler] Enqueued episodic_clustering_requested for user ${user.id}`);
        }
    }
}
//# sourceMappingURL=episode.scheduler.js.map