import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { insertEvent } from '../core/events.js';

export function startDecayScheduler() {
  console.log('[DecayScheduler] Starting Decay Scheduler...');

  // Cycle every 4 hours
  setInterval(async () => {
    try {
      await enqueueDecayTasks();
    } catch (err) {
      console.error('[DecayScheduler] Error enqueuing tasks:', err);
    }
  }, 4 * 60 * 60 * 1000);

  // Proactive run after 40 seconds on startup
  setTimeout(async () => {
    try {
      console.log('[DecayScheduler] Running initial task enqueuing...');
      await enqueueDecayTasks();
    } catch (err) {
      console.error('[DecayScheduler] Startup enqueuing failed:', err);
    }
  }, 40000);
}

async function enqueueDecayTasks() {
  const allUsers = await db.select({ id: users.id }).from(users);

  for (const user of allUsers) {
    const existing = await db.execute(sql`
      SELECT id FROM events
      WHERE user_id = ${user.id}
      AND event_type = 'decay_requested'
      AND processing_status IN ('pending', 'processing', 'retrying')
      LIMIT 1
    `);

    if (existing.rows.length === 0) {
      await insertEvent(db, {
        userId: user.id,
        eventType: 'decay_requested',
        payload: {},
        priority: 'background',
      });
      console.log(`[DecayScheduler] Enqueued decay_requested for user ${user.id}`);
    }
  }
}
