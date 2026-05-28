import { db } from '../db/index.js';
import { events, notifications, users } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { queueProvider } from '../core/queue.js';
import { withAdvisoryLock, LOCK_NOTIFICATION } from '../core/locks.js';
import { CognitionService } from '../services/cognition.service.js';
import { CognitionLogger } from '../core/observability.js';
import { isEventReadyForRetry } from './llm_extractor.js';

const MAX_RETRIES = 5;

export const startNotificationWorker = () => {
  console.log('[NotificationWorker] Starting Notification Worker...');

  // Subscribe to notification channel
  queueProvider.subscribe('notification_queue', async (msg) => {
    if (msg.eventType === 'push_notification_requested') {
      try {
        await processNotificationEventById(msg.id);
      } catch (error) {
        console.error('[NotificationWorker] Notification handling failed:', error);
      }
    }
  });

  // Sweep for pending notifications every 15 seconds
  setInterval(async () => {
    try {
      await sweepPendingNotifications();
    } catch (error) {
      console.error('[NotificationWorker] Notification sweep error:', error);
    }
  }, 15000);
};

async function sweepPendingNotifications() {
  const pendingEvents = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'push_notification_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 5
  `);

  for (const row of pendingEvents.rows) {
    await processNotificationEventById(row.id as string);
  }
}

async function processNotificationEventById(eventId: string) {
  const selectRes = await db.execute(sql`
    SELECT * FROM events WHERE id = ${eventId} LIMIT 1
  `);
  if (selectRes.rows.length === 0) return;
  const eventRow = selectRes.rows[0] as any;

  // 1. Backoff Check
  if (eventRow.processing_status === 'retrying') {
    if (!isEventReadyForRetry(new Date(eventRow.created_at), eventRow.retry_count || 0)) {
      return;
    }
  }

  // 2. Claim Atomically
  const claimRes = await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);
  if (claimRes.rows.length === 0) return; // Already claimed

  const userId = eventRow.user_id as string;
  const payload = eventRow.payload as any;
  const priority = eventRow.priority as string || 'normal';
  const startTime = Date.now();

  try {
    const lockAcquired = await withAdvisoryLock(LOCK_NOTIFICATION, async (tx) => {
      // Fetch user timezone settings
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Timezone-Aware Quiet Hours check (10:00 PM to 7:00 AM)
      const timezone = user.timezone || 'UTC';
      const localHour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      }).format(new Date()));

      const isQuietHours = localHour >= 22 || localHour < 7;
      const isCritical = priority === 'urgent' || priority === 'critical';

      if (isQuietHours && !isCritical) {
        // Defer notification by putting it back to pending
        await tx.execute(sql`
          UPDATE events SET processing_status = 'pending', retry_count = 0
          WHERE id = ${eventId}
        `);
        
        CognitionLogger.log({
          subsystem: 'notification',
          action: 'notification_suppressed',
          userId,
          inputs: { localHour, priority },
          reason: `Notification deferred due to quiet hours (${localHour}:00) in ${timezone} timezone.`,
        });
        return true;
      }

      // Check notification fatigue and overload
      const recentNotifications = await tx.execute(sql`
        SELECT COUNT(*)::int as count FROM notifications
        WHERE user_id = ${userId}
        AND created_at > NOW() - INTERVAL '4 hours'
        AND delivery_status = 'sent'
      `);
      const recentCount = Number((recentNotifications.rows[0] as any)?.count || 0);

      const fatigueEval = CognitionService.evaluateNotificationFatigue(recentCount, priority);

      // Idempotency: Double check that we have not already inserted a notification record for this eventId
      const existingNotif = await tx.execute(sql`
        SELECT id FROM notifications WHERE event_id = ${eventId} LIMIT 1
      `);
      if (existingNotif.rows.length > 0) {
        await tx.execute(sql`
          UPDATE events SET processing_status = 'completed' WHERE id = ${eventId}
        `);
        return true;
      }

      if (fatigueEval.shouldGate) {
        // Gated: put back to pending, delay dispatch
        await tx.execute(sql`
          UPDATE events SET processing_status = 'pending', retry_count = 0
          WHERE id = ${eventId}
        `);

        CognitionLogger.log({
          subsystem: 'notification',
          action: 'notification_gated',
          userId,
          inputs: { recentCount, fatigueScore: fatigueEval.notificationFatigue },
          reason: `Notification gated due to high cognitive overload score (${fatigueEval.cognitiveOverloadScore}).`,
        });
        return true;
      }

      // Dispatch alert (FCM mock)
      console.log(`[NotificationWorker] FCM Dispatch: user ${user.email} | Title: "${payload.title}"`);

      await tx.insert(notifications).values({
        userId,
        eventId,
        title: payload.title,
        body: payload.body,
        priority,
        cognitiveImportance: isCritical ? 1.0 : 0.5,
        interruptionScore: fatigueEval.interruptionScore,
        notificationFatigue: fatigueEval.notificationFatigue,
        dismissalVelocity: 0.0,
        cognitiveOverloadScore: fatigueEval.cognitiveOverloadScore,
        deliveryStatus: 'sent',
        lastSentAt: new Date()
      });

      // Complete event
      await tx.execute(sql`
        UPDATE events SET processing_status = 'completed'
        WHERE id = ${eventId}
      `);

      CognitionLogger.log({
        subsystem: 'notification',
        action: 'notification_sent',
        userId,
        outputs: { title: payload.title, fatigue: fatigueEval.notificationFatigue },
        latencyMs: Date.now() - startTime,
        reason: `Successfully dispatched notification for event ${eventId} in timezone ${timezone}.`,
      });
      return true;
    });

    if (!lockAcquired) {
      await db.execute(sql`
        UPDATE events
        SET processing_status = 'retrying'
        WHERE id = ${eventId}
      `);
    }
  } catch (e: any) {
    const currentRetry = ((eventRow.retry_count as number) || 0) + 1;
    const isDlq = currentRetry >= MAX_RETRIES;
    const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
    const errorMessage = e?.stack || e?.message || String(e);

    await db.execute(sql`
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);

    if (isDlq) {
      console.error(`[NotificationWorker] Notification ${eventId} moved to DLQ. Error: ${errorMessage}`);
    } else {
      console.warn(`[NotificationWorker] Notification ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}
