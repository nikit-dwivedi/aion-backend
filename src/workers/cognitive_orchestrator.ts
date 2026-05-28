import { db } from '../db/index.js';
import { events, nodes, edges, users } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { PgNotifyListener, type NotifyPayload } from '../services/pg_notify_listener.service.js';
import { cleanAndParseJson, normalizeAllUserTimezones } from '../core/utils.js';

const MAX_RETRIES = 5;
const DEBOUNCE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes consolidation buffer
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Cognitive Orchestrator Worker:
 * 1. Scheduled: Generate a fresh daily_plan at ~6:00 AM in each user's local timezone.
 * 2. Reactive & Consolidated: Debounce plan update requests by 10 minutes for standard thoughts,
 *    while executing urgent triggers (emotional spikes, explicit requests) immediately.
 */
export const startOrchestrationWorker = () => {
  console.log('[Orchestrator] Starting Cognitive Orchestration Worker...');

  // Trigger timezone normalization check asynchronously on startup
  normalizeAllUserTimezones().catch(err => {
    console.error('[Orchestrator] Failed to run timezone normalization:', err);
  });

  // 1. Reactive: LISTEN/NOTIFY push-based processing for plan updates
  const listener = new PgNotifyListener('aion_plan_queue', handlePlanNotification);
  listener.start().catch(err => {
    console.error('[Orchestrator] Failed to start LISTEN/NOTIFY listener:', err);
  });

  // 2. Scheduled: Check for morning plan generation every 5 minutes
  setInterval(async () => {
    try {
      await generateScheduledPlans();
    } catch (error) {
      console.error('[Orchestrator] Scheduled generation error:', error);
    }
  }, 5 * 60 * 1000);

  // 3. Fallback & Debounce Sweep: Check for pending/debounced updates every 2 minutes
  setInterval(async () => {
    try {
      await sweepPendingPlanUpdates();
    } catch (error) {
      console.error('[Orchestrator] Sweep error:', error);
    }
  }, 120000);
};

async function handlePlanNotification(payload: NotifyPayload): Promise<void> {
  try {
    await processPlanUpdateById(payload.id);
  } catch (error) {
    console.error(`[Orchestrator] Notification handler error for event ${payload.id}:`, error);
  }
}

// ─── Scheduled Plan Generation ───────────────────────────────────────────────

async function generateScheduledPlans() {
  if (!llm.isConfigured) return;

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
    console.log(`[Orchestrator] Generating daily plan for user ${userId} (${tz})...`);

    try {
      await generatePlanForUser(userId);
      console.log(`[Orchestrator] Daily plan generated for user ${userId}`);
    } catch (e) {
      console.error(`[Orchestrator] Failed to generate plan for user ${userId}:`, e);
    }

    await delay(3000);
  }
}

// ─── Reactive Plan Updates (Push & Sweep Debounced) ──────────────────────────

async function sweepPendingPlanUpdates(): Promise<void> {
  if (!llm.isConfigured) return;

  // Sweep scans for any pending updates. It acts as the consolidator for debounced tasks.
  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'plan_update_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
  `);

  if (pending.rows.length === 0) return;

  // Process unique users to avoid redundant loops
  const uniqueEventIds = new Set<string>();
  const processedUsers = new Set<string>();

  for (const row of pending.rows) {
    const eventId = row.id as string;
    uniqueEventIds.add(eventId);
  }

  for (const eventId of uniqueEventIds) {
    try {
      await processPlanUpdateById(eventId);
    } catch (error) {
      console.error(`[Orchestrator] Sweep processing failed for event ${eventId}:`, error);
    }
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
  const priority = row.priority as string;
  const requiresImmediateAttention = !!row.requires_immediate_attention;
  const payload = row.payload as any;

  // 1. Debounce Gating for Low/Normal Priority Events
  const isUrgent = priority === 'urgent' || priority === 'critical' || requiresImmediateAttention;

  if (!isUrgent) {
    // Check the oldest pending request for this user
    const oldestPendingResult = await db.execute(sql`
      SELECT created_at FROM events
      WHERE user_id = ${userId}
      AND event_type = 'plan_update_requested'
      AND processing_status IN ('pending', 'retrying')
      ORDER BY created_at ASC
      LIMIT 1
    `);

    const oldestPendingTime = oldestPendingResult.rows[0] && (oldestPendingResult.rows[0] as any).created_at 
      ? new Date((oldestPendingResult.rows[0] as any).created_at) 
      : new Date();

    const ageMs = Date.now() - oldestPendingTime.getTime();

    // If oldest event in buffer is newer than DEBOUNCE_WINDOW_MS, skip for now.
    // The sweep worker running every 2 minutes will re-evaluate once the threshold is crossed.
    if (ageMs < DEBOUNCE_WINDOW_MS) {
      console.log(`[Orchestrator] Debouncing plan update for user ${userId}. Age: ${Math.round(ageMs / 1000)}s / ${DEBOUNCE_WINDOW_MS / 1000}s. Skipping.`);
      return;
    }
  }

  // 2. Atomic claim
  await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
  `);

  console.log(`[Orchestrator] Processing plan update for user ${userId} (Urgent: ${isUrgent})`);

  try {
    const currentPlan = await getTodaysPlan(userId);

    if (!currentPlan) {
      // Generate daily plan fresh
      await generatePlanForUser(userId);
    } else {
      // Fetch the last generation/update timestamp of this plan
      const lastPlanTime = currentPlan.updated_at ? new Date(currentPlan.updated_at) : new Date(0);

      // Consolidate: Fetch all memories created since the last plan update
      const freshMemories = await db.execute(sql`
        SELECT content FROM nodes
        WHERE user_id = ${userId}
        AND node_type = 'memory'
        AND created_at > ${lastPlanTime}
        ORDER BY created_at ASC
      `);

      let newInfo = payload.newInfo || payload.reason || '';

      if (freshMemories.rows.length > 0) {
        newInfo = freshMemories.rows.map((r: any, idx: number) => `[Thought #${idx + 1}] ${r.content}`).join('\n');
      }

      const prompt = `
        You are AION's daily planning engine. The user's current daily plan is:
        ${currentPlan.content}
        
        New information has arrived since the last planning session:
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

      let aiResponseResult = await llm.generateContentWithMetrics({ prompt });
      const parsed = cleanAndParseJson(aiResponseResult.text);

      const promptTokens = aiResponseResult.usage?.promptTokens || 0;
      const completionTokens = aiResponseResult.usage?.completionTokens || 0;
      const estimatedCost = (promptTokens * 0.000075 + completionTokens * 0.0003) / 1000;
      const tokenUsage = promptTokens + completionTokens;

      if (parsed.changed) {
        const updatedContent = JSON.stringify({
          greeting: parsed.greeting,
          schedule: parsed.schedule,
          focusHighlight: parsed.focusHighlight,
        });

        await db.update(nodes)
          .set({ content: updatedContent, updatedAt: new Date() })
          .where(eq(nodes.id, currentPlan.id as string));

        console.log(`[Orchestrator] Plan updated successfully for user ${userId}`);

        // Emit push notification requested event
        await db.insert(events).values({
          userId,
          eventType: 'push_notification_requested',
          payload: {
            title: 'Plan Updated',
            body: `Your daily plan was adjusted: ${parsed.focusHighlight}`,
            type: 'plan_updated',
          },
          priority: 'normal',
        });
      } else {
        console.log(`[Orchestrator] No plan modifications needed for user ${userId}`);
      }

      // Mark all plan_update_requested events in this debounced consolidation block as completed
      await db.execute(sql`
        UPDATE events SET 
          processing_status = 'completed',
          estimated_cost = ${estimatedCost},
          token_usage = ${tokenUsage}
        WHERE user_id = ${userId}
        AND event_type = 'plan_update_requested'
        AND processing_status IN ('pending', 'processing', 'retrying')
      `);

      await db.insert(events).values({
        userId,
        eventType: 'plan_update_processed',
        payload: { sourcePlanUpdateId: eventId },
      });
    }
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
      console.error(`[Orchestrator] Event ${eventId} moved to DLQ after ${MAX_RETRIES} failures. Error: ${errorMessage}`);
    } else {
      console.warn(`[Orchestrator] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}

// ─── Core Plan Generation ────────────────────────────────────────────────────

async function generatePlanForUser(userId: string) {
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
    WHERE user_id = ${userId} AND node_type = 'research'
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

  let aiResponseResult = await llm.generateContentWithMetrics({ prompt });
  const parsed = cleanAndParseJson(aiResponseResult.text);
  const planContent = JSON.stringify(parsed);

  const promptTokens = aiResponseResult.usage?.promptTokens || 0;
  const completionTokens = aiResponseResult.usage?.completionTokens || 0;
  const estimatedCost = (promptTokens * 0.000075 + completionTokens * 0.0003) / 1000;
  const tokenUsage = promptTokens + completionTokens;

  // Upsert daily plan
  const existingPlan = await getTodaysPlan(userId);

  await db.transaction(async (tx) => {
    if (existingPlan) {
      await tx.update(nodes)
        .set({ content: planContent, updatedAt: new Date() })
        .where(eq(nodes.id, existingPlan.id as string));
    } else {
      await tx.insert(nodes).values({
        userId,
        nodeType: 'daily_plan',
        content: planContent,
      });
    }

    // Log the completed event
    await tx.insert(events).values({
      userId,
      eventType: 'plan_generated',
      payload: { plan: parsed },
      estimatedCost,
      tokenUsage
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTodaysPlan(userId: string) {
  const result = await db.execute(sql`
    SELECT id, content, updated_at FROM nodes
    WHERE user_id = ${userId}
    AND node_type = 'daily_plan'
    AND created_at::date = CURRENT_DATE
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  const row = result.rows[0] as any;
  if (!row) return null;
  return {
    id: row.id as string,
    content: row.content as string,
    updated_at: row.updated_at as string
  };
}
