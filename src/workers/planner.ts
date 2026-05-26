import { db } from '../db/index.js';
import { events, nodes, edges, users } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { PgNotifyListener, type NotifyPayload } from '../services/pg_notify_listener.service.js';
import { cleanAndParseJson, normalizeAllUserTimezones } from '../core/utils.js';

const MAX_RETRIES = 5;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Planner Worker has two jobs:
 * 1. Scheduled: Generate a fresh daily_plan at ~6:00 AM in each user's local timezone. (remains polling — cron-scheduled)
 * 2. Reactive: When a plan_update_requested event fires, re-evaluate and overwrite the plan. (LISTEN/NOTIFY push)
 */
export const startPlannerWorker = () => {
  console.log('[Planner] Starting Daily Plan Worker (hybrid push/scheduled)...');

  // Trigger timezone normalization check asynchronously on startup
  normalizeAllUserTimezones().catch(err => {
    console.error('[Planner] Failed to run timezone normalization:', err);
  });

  // 1. Reactive: LISTEN/NOTIFY push-based processing for plan updates
  const listener = new PgNotifyListener('aion_plan_queue', handlePlanNotification);
  listener.start().catch(err => {
    console.error('[Planner] Failed to start LISTEN/NOTIFY listener:', err);
  });

  // 2. Scheduled: Check for morning plan generation every 5 minutes (inherently cron-like)
  setInterval(async () => {
    try {
      await generateScheduledPlans();
    } catch (error) {
      console.error('[Planner] Scheduled generation error:', error);
    }
  }, 5 * 60 * 1000);

  // 3. Fallback sweep for missed plan_update_requested events
  setInterval(async () => {
    try {
      await sweepPendingPlanUpdates();
    } catch (error) {
      console.error('[Planner] Sweep error:', error);
    }
  }, 120000); // Every 2 minutes
};

async function handlePlanNotification(payload: NotifyPayload): Promise<void> {
  try {
    await processPlanUpdateById(payload.id);
  } catch (error) {
    console.error(`[Planner] Notification handler error for event ${payload.id}:`, error);
  }
}

// ─── Scheduled Plan Generation ───────────────────────────────────────────────

async function generateScheduledPlans() {
  if (!llm.isConfigured) return;

  // Find users who don't have a plan for today (in their local timezone)
  const usersNeedingPlan = await db.execute(sql`
    SELECT u.id, u.timezone FROM users u
    WHERE (EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone) BETWEEN 5 AND 7)
    AND NOT EXISTS (
      SELECT 1 FROM nodes n
      WHERE n.user_id = u.id
      AND n.node_type = 'daily_plan'
      AND (n.created_at AT TIME ZONE u.timezone)::date = (NOW() AT TIME ZONE u.timezone)::date
    )
  `);

  if (usersNeedingPlan.rows.length === 0) return;

  for (const user of usersNeedingPlan.rows) {
    const userId = user.id as string;
    const tz = user.timezone as string;
    console.log(`[Planner] Generating daily plan for user ${userId} (${tz})...`);

    try {
      await generatePlanForUser(userId);
      console.log(`[Planner] Daily plan generated for user ${userId}`);
    } catch (e) {
      console.error(`[Planner] Failed to generate plan for user ${userId}:`, e);
    }

    await delay(3000); // Rate limiting between users
  }
}

// ─── Reactive Plan Updates (Push-Driven) ─────────────────────────────────────

async function sweepPendingPlanUpdates(): Promise<void> {
  if (!llm.isConfigured) return;

  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'plan_update_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'plan_update_processed'
      AND e2.payload->>'sourcePlanUpdateId' = events.id::text
    )
    ORDER BY created_at ASC
    LIMIT 3
  `);

  if (pending.rows.length === 0) return;

  console.log(`[Planner] Sweep found ${pending.rows.length} pending plan update(s).`);
  for (const row of pending.rows) {
    await processPlanUpdateById(row.id as string);
  }
}

async function processPlanUpdateById(eventId: string): Promise<void> {
  if (!llm.isConfigured) return;

  const result = await db.execute(sql`
    SELECT * FROM events
    WHERE id = ${eventId}
    AND event_type = 'plan_update_requested'
    AND processing_status != 'completed'
    AND processing_status != 'failed'
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as any;
  if (!row) return;
  const userId = row.user_id as string;
  const payload = row.payload as any;

  // Atomic claim
  await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
  `);

  console.log(`[Planner] Reactive update triggered for user ${userId}: "${payload.reason}"`);

  try {
    // 1. Get today's current plan
    const currentPlan = await getTodaysPlan(userId);

    if (!currentPlan) {
      // No plan exists yet, generate one fresh
      await generatePlanForUser(userId);
    } else {
      // 2. Ask LLM if the new info changes the plan
      const newInfo = payload.newInfo || payload.reason || '';

      const prompt = `
        You are AION's daily planning engine. The user's current daily plan is:
        ${currentPlan.content}
        
        New information has arrived:
        "${newInfo}"
        
        Does this new information require updating the daily plan? If yes, produce a completely revised plan.
        If no, return the existing plan unchanged.
        
        Return a JSON object:
        {
          "changed": true/false,
          "greeting": "A short motivating message",
          "schedule": ["Array of time-block strings"],
          "focusHighlight": "The single most important focus for today"
        }
        Output ONLY raw JSON. No markdown.
      `;

      let aiResponse = await llm.generateContent({ prompt });
      const parsed = cleanAndParseJson(aiResponse);

      if (parsed.changed) {
        // Overwrite the existing plan node
        const updatedContent = JSON.stringify({
          greeting: parsed.greeting,
          schedule: parsed.schedule,
          focusHighlight: parsed.focusHighlight,
        });

        await db.update(nodes)
          .set({ content: updatedContent, updatedAt: new Date() })
          .where(eq(nodes.id, currentPlan.id as string));

        console.log(`[Planner] Plan updated for user ${userId}`);

        // Emit notification event for push notification
        await db.insert(events).values({
          userId,
          eventType: 'push_notification_requested',
          payload: {
            title: 'Plan Updated',
            body: `Your daily plan was adjusted: ${parsed.focusHighlight}`,
            type: 'plan_updated',
          },
        });
      } else {
        console.log(`[Planner] No plan change needed for user ${userId}`);
      }
    }

    // Mark as completed
    await db.execute(sql`
      UPDATE events SET processing_status = 'completed'
      WHERE id = ${eventId}
    `);

    await db.insert(events).values({
      userId,
      eventType: 'plan_update_processed',
      payload: { sourcePlanUpdateId: eventId },
    });
  } catch (e: any) {
    // DLQ: increment retry count, store error trace
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
      console.error(`[Planner] Event ${eventId} moved to DLQ after ${MAX_RETRIES} failures. Last error: ${errorMessage}`);
    } else {
      console.warn(`[Planner] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}

// ─── Core Plan Generation ────────────────────────────────────────────────────

async function generatePlanForUser(userId: string) {
  // Gather context: recent memories, active action items, active projects, recent research
  const recentMemories = await db.execute(sql`
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'memory'
    ORDER BY created_at DESC LIMIT 10
  `);

  const actionItems = await db.execute(sql`
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'action_item'
    ORDER BY created_at DESC LIMIT 10
  `);

  const activeProjects = await db.execute(sql`
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'project'
    ORDER BY created_at DESC LIMIT 5
  `);

  const recentResearch = await db.execute(sql`
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'memory'
    AND content LIKE '[Research]%'
    ORDER BY created_at DESC LIMIT 3
  `);

  const activeTasks = await db.execute(sql`
    SELECT t.content as task, g.content as goal
    FROM nodes t
    JOIN edges e ON e.source_node_id = t.id
    JOIN nodes g ON e.target_node_id = g.id
    WHERE t.node_type = 'task' AND g.node_type = 'goal' AND t.user_id = ${userId}
    LIMIT 10
  `);

  const memoriesText = recentMemories.rows.map((r: any) => `- ${r.content}`).join('\n');
  const actionsText = actionItems.rows.map((r: any) => `- ${r.content}`).join('\n');
  const projectsText = activeProjects.rows.map((r: any) => r.content).join(', ');
  const researchText = recentResearch.rows.map((r: any) => `- ${r.content}`).join('\n');
  const tasksText = activeTasks.rows.map((r: any) => `[Goal: ${r.goal}] ${r.task}`).join('\n');

  const prompt = `
    You are AION, generating the user's Daily Focus Plan.
    
    Recent thoughts and memories:
    ${memoriesText || 'No recent thoughts.'}
    
    Pending action items (extracted from thoughts):
    ${actionsText || 'No pending action items.'}
    
    Active projects:
    ${projectsText || 'No active projects.'}
    
    Active goal tasks:
    ${tasksText || 'No active goal tasks.'}
    
    Recent autonomous research findings:
    ${researchText || 'No recent research.'}
    
    Generate a realistic, motivating daily plan with 3-7 key focus areas or time-blocks.
    Weave together action items, goal tasks, and recent insights into a cohesive plan.
    Prioritize unfinished action items and urgent topics.
    
    Return a JSON object:
    {
      "greeting": "A short, personal good morning message referencing something specific from their context",
      "schedule": ["Morning: ...", "Midday: ...", "Afternoon: ...", "Evening: ..."],
      "focusHighlight": "The single most important thing to accomplish today"
    }
    Output ONLY raw JSON. No markdown.
  `;

  let aiResponse = await llm.generateContent({ prompt });
  const parsed = cleanAndParseJson(aiResponse);
  const planContent = JSON.stringify(parsed);

  // Upsert: if a plan already exists for today, overwrite it
  const existingPlan = await getTodaysPlan(userId);

  if (existingPlan) {
    await db.update(nodes)
      .set({ content: planContent, updatedAt: new Date() })
      .where(eq(nodes.id, existingPlan.id as string));
  } else {
    await db.insert(nodes).values({
      userId,
      nodeType: 'daily_plan',
      content: planContent,
    });
  }

  // Log the event
  await db.insert(events).values({
    userId,
    eventType: 'plan_generated',
    payload: { plan: parsed },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTodaysPlan(userId: string) {
  const result = await db.execute(sql`
    SELECT id, content FROM nodes
    WHERE user_id = ${userId}
    AND node_type = 'daily_plan'
    AND created_at::date = CURRENT_DATE
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return result.rows[0] || null;
}
