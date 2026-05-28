import { db } from '../db/index.js';
import { events, notifications, users } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { cleanAndParseJson } from '../core/utils.js';

const MAX_RETRIES = 5;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * FCM Notification Dispatch Worker
 * 
 * Periodically processes 'push_notification_requested' events from the cognitive event log,
 * enforcing cognitive fatigue caps, timezone-aware quiet hours, and priority gating.
 */
export const startNotificationWorker = () => {
  console.log('[NotificationWorker] Starting Notification Worker...');

  // Sweep for pending notification requests every 15 seconds
  setInterval(async () => {
    try {
      await processPendingNotifications();
    } catch (error) {
      console.error('[NotificationWorker] Notification sweep error:', error);
    }
  }, 15000);
};

async function processPendingNotifications() {
  const pendingEvents = await db.execute(sql`
    SELECT * FROM events
    WHERE event_type = 'push_notification_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 5
  `);

  if (pendingEvents.rows.length === 0) return;

  for (const row of pendingEvents.rows) {
    await processNotificationEvent(row);
  }
}

async function processNotificationEvent(row: any) {
  const eventId = row.id as string;
  const userId = row.user_id as string;
  const payload = row.payload as any;
  const priority = row.priority as string || 'normal';

  // Atomic claim
  await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
  `);

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // 1. Gating Step: Timezone-Aware Quiet Hours
    const timezone = user.timezone || 'UTC';
    const localHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    }).format(new Date()));

    const isQuietHours = localHour >= 22 || localHour < 7; // Quiet hours: 10:00 PM to 7:00 AM
    const isCritical = priority === 'urgent' || priority === 'critical';

    if (isQuietHours && !isCritical) {
      console.log(`[NotificationWorker] Quiet hours active (${localHour}:00) in ${timezone} for user ${userId}. Deferring low/normal priority notification.`);
      // Defer event by resetting to pending, allowing sweep to retry later
      await db.execute(sql`
        UPDATE events SET processing_status = 'pending', retry_count = 0
        WHERE id = ${eventId}
      `);
      return;
    }

    // 2. Gating Step: Cognitive Overload & Notification Fatigue Modeling
    // Check how many notifications were dispatched to this user in the last 4 hours
    const recentNotifications = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM notifications
      WHERE user_id = ${userId}
      AND created_at > NOW() - INTERVAL '4 hours'
      AND delivery_status = 'sent'
    `);
    const recentCount = Number((recentNotifications.rows[0] as any)?.count || 0);

    let notificationFatigue = recentCount * 0.25;
    let cognitiveOverloadScore = recentCount > 2 ? 0.8 : 0.2;
    const interruptionScore = priority === 'high' ? 0.7 : priority === 'critical' ? 1.0 : 0.3;

    // Gate interruptions if fatigue exceeds limit and event is not critical
    if (cognitiveOverloadScore > 0.7 && !isCritical) {
      console.log(`[NotificationWorker] High cognitive overload (${cognitiveOverloadScore}) for user ${userId}. Gating standard notification to preserve focus.`);
      // Keep it pending and skip immediate execution
      await db.execute(sql`
        UPDATE events SET processing_status = 'pending', retry_count = 0
        WHERE id = ${eventId}
      `);
      return;
    }

    // 3. FCM Dispatch (Mock service execution)
    console.log(`[NotificationWorker] DISPATCHING FCM PUSH to user ${user.email} (${timezone}):`);
    console.log(`  > Title: "${payload.title}"`);
    console.log(`  > Body: "${payload.body}"`);
    console.log(`  > Priority: ${priority} | Fatigue: ${notificationFatigue} | Interruption Score: ${interruptionScore}`);

    // Insert delivery record to database
    await db.insert(notifications).values({
      userId,
      eventId,
      title: payload.title,
      body: payload.body,
      priority,
      cognitiveImportance: isCritical ? 1.0 : 0.5,
      interruptionScore,
      notificationFatigue,
      dismissalVelocity: 0.0,
      cognitiveOverloadScore,
      deliveryStatus: 'sent',
      lastSentAt: new Date()
    });

    // Mark event as completed
    await db.execute(sql`
      UPDATE events SET processing_status = 'completed'
      WHERE id = ${eventId}
    `);

    console.log(`[NotificationWorker] Push notification processed successfully for event ${eventId}`);
  } catch (e: any) {
    const currentRetry = ((row.retry_count as number) || 0) + 1;
    const newStatus = currentRetry >= MAX_RETRIES ? 'failed' : 'retrying';
    const errorMessage = e?.message || String(e);

    await db.execute(sql`
      UPDATE events
      SET processing_status = ${newStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);

    if (newStatus === 'failed') {
      console.error(`[NotificationWorker] Notification ${eventId} moved to DLQ after ${MAX_RETRIES} failures. Error: ${errorMessage}`);
    } else {
      console.warn(`[NotificationWorker] Notification ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}
