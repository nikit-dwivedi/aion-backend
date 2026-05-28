import { db } from '../db/index.js';
import { users, events } from '../db/schema.js';
import { sql, and, eq, inArray } from 'drizzle-orm';
import { insertEvent } from '../core/events.js';
export function startReinforcementScheduler() {
    console.log('[ReinforcementScheduler] Starting Reinforcement Scheduler...');
    // Cycle every 4 hours
    setInterval(async () => {
        try {
            await enqueueReinforcementTasks();
        }
        catch (err) {
            console.error('[ReinforcementScheduler] Error enqueuing tasks:', err);
        }
    }, 4 * 60 * 60 * 1000);
    // Proactive run after 40 seconds on startup
    setTimeout(async () => {
        try {
            console.log('[ReinforcementScheduler] Running initial task enqueuing...');
            await enqueueReinforcementTasks();
        }
        catch (err) {
            console.error('[ReinforcementScheduler] Startup enqueuing failed:', err);
        }
    }, 40000);
}
async function enqueueReinforcementTasks() {
    const allUsers = await db.select({ id: users.id }).from(users);
    for (const user of allUsers) {
        // Check if there is already a pending or active reinforcement task for this user
        const existing = await db.execute(sql `
      SELECT id FROM events
      WHERE user_id = ${user.id}
      AND event_type = 'reinforcement_requested'
      AND processing_status IN ('pending', 'processing', 'retrying')
      LIMIT 1
    `);
        if (existing.rows.length === 0) {
            await insertEvent(db, {
                userId: user.id,
                eventType: 'reinforcement_requested',
                payload: {},
                priority: 'background',
            });
            console.log(`[ReinforcementScheduler] Enqueued reinforcement_requested for user ${user.id}`);
        }
    }
}
//# sourceMappingURL=reinforcement.scheduler.js.map