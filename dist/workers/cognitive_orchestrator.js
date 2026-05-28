import { db } from '../db/index.js';
import { events, nodes, edges, users } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { queueProvider } from '../core/queue.js';
import { cleanAndParseJson, normalizeAllUserTimezones } from '../core/utils.js';
import { withAdvisoryLock, LOCK_PLAN_ORCHESTRATION } from '../core/locks.js';
import { insertEvent } from '../core/events.js';
import { CognitionLogger } from '../core/observability.js';
import { isEventReadyForRetry } from './llm_extractor.js';
const MAX_RETRIES = 5;
const DEBOUNCE_WINDOW_MS = 10 * 60 * 1000;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const startOrchestrationWorker = () => {
    console.log('[Orchestrator] Starting Cognitive Orchestration Worker...');
    normalizeAllUserTimezones().catch(err => {
        console.error('[Orchestrator] Failed to run timezone normalization:', err);
    });
    // Subscribe to critical and normal queues
    queueProvider.subscribe('critical_cognition_queue', async (msg) => {
        if (msg.eventType === 'plan_update_requested') {
            try {
                await processPlanUpdateById(msg.id);
            }
            catch (error) {
                console.error(`[Orchestrator] Critical Plan Update notification error:`, error);
            }
        }
    });
    queueProvider.subscribe('normal_cognition_queue', async (msg) => {
        if (msg.eventType === 'plan_update_requested') {
            try {
                await processPlanUpdateById(msg.id);
            }
            catch (error) {
                console.error(`[Orchestrator] Normal Plan Update notification error:`, error);
            }
        }
    });
    // Scheduled: check for morning plan generation every 5 minutes
    setInterval(async () => {
        try {
            await generateScheduledPlans();
        }
        catch (error) {
            console.error('[Orchestrator] Scheduled generation error:', error);
        }
    }, 5 * 60 * 1000);
    // Fallback and Debounce Sweep
    setInterval(async () => {
        try {
            await sweepPendingPlanUpdates();
        }
        catch (error) {
            console.error('[Orchestrator] Sweep error:', error);
        }
    }, 120000);
};
async function generateScheduledPlans() {
    if (!llm.isConfigured)
        return;
    const usersNeedingPlan = await db.execute(sql `
    SELECT u.id, u.timezone FROM users u
    WHERE (EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone) BETWEEN 5 AND 7)
    AND NOT EXISTS (
      SELECT 1 FROM nodes n
      WHERE n.user_id = u.id
      AND n.node_type = 'daily_plan'
      AND (n.created_at AT TIME ZONE u.timezone)::date = (NOW() AT TIME ZONE u.timezone)::date
    )
  `);
    for (const user of usersNeedingPlan.rows) {
        const userId = user.id;
        console.log(`[Orchestrator] Scheduled plan generation triggered for user ${userId}`);
        try {
            await generatePlanForUser(userId);
        }
        catch (e) {
            console.error(`[Orchestrator] Scheduled generation failed:`, e);
        }
        await delay(3000);
    }
}
async function sweepPendingPlanUpdates() {
    const pending = await db.execute(sql `
    SELECT id FROM events
    WHERE event_type = 'plan_update_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY CASE WHEN priority = 'critical' THEN 5 WHEN priority = 'urgent' THEN 4 WHEN priority = 'high' THEN 4 WHEN priority = 'important' THEN 4 WHEN priority = 'normal' THEN 3 WHEN priority = 'background' THEN 2 ELSE 1 END DESC, created_at ASC
  `);
    for (const row of pending.rows) {
        await processPlanUpdateById(row.id);
    }
}
async function processPlanUpdateById(eventId) {
    const startTime = Date.now();
    const selectRes = await db.execute(sql `
    SELECT * FROM events WHERE id = ${eventId} LIMIT 1
  `);
    if (selectRes.rows.length === 0)
        return;
    const eventRow = selectRes.rows[0];
    // 1. Backoff Check
    if (eventRow.processing_status === 'retrying') {
        if (!isEventReadyForRetry(new Date(eventRow.created_at), eventRow.retry_count || 0)) {
            return;
        }
    }
    const userId = eventRow.user_id;
    const priority = eventRow.priority;
    const requiresImmediateAttention = !!eventRow.requires_immediate_attention;
    const payload = eventRow.payload;
    // 2. Debounce Gating
    const isUrgent = priority === 'urgent' || priority === 'critical' || requiresImmediateAttention;
    if (!isUrgent) {
        const oldestPendingResult = await db.execute(sql `
      SELECT created_at FROM events
      WHERE user_id = ${userId}
      AND event_type = 'plan_update_requested'
      AND processing_status IN ('pending', 'retrying')
      ORDER BY created_at ASC
      LIMIT 1
    `);
        const oldestPendingTime = oldestPendingResult.rows[0] && oldestPendingResult.rows[0].created_at
            ? new Date(oldestPendingResult.rows[0].created_at)
            : new Date();
        const ageMs = Date.now() - oldestPendingTime.getTime();
        if (ageMs < DEBOUNCE_WINDOW_MS) {
            return; // Skip for now, let sweep handle it later once debounce expires
        }
    }
    // 3. Atomic claim
    const claimRes = await db.execute(sql `
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);
    if (claimRes.rows.length === 0)
        return;
    try {
        const lockAcquired = await withAdvisoryLock(LOCK_PLAN_ORCHESTRATION, async (tx) => {
            const currentPlan = await getTodaysPlan(userId);
            if (!currentPlan) {
                await generatePlanForUser(userId);
            }
            else {
                const lastPlanTime = currentPlan.updated_at ? new Date(currentPlan.updated_at) : new Date(0);
                const freshMemories = await tx.execute(sql `
          SELECT content FROM nodes
          WHERE user_id = ${userId}
          AND node_type = 'memory'
          AND created_at > ${lastPlanTime}
          ORDER BY created_at ASC
        `);
                let newInfo = payload.newInfo || payload.reason || '';
                if (freshMemories.rows.length > 0) {
                    newInfo = freshMemories.rows.map((r, idx) => `[Thought #${idx + 1}] ${r.content}`).join('\n');
                }
                const prompt = `
          You are AION's daily planning engine. The user's current daily plan is:
          ${currentPlan.content}
          
          New information:
          "${newInfo}"
          
          Update the plan if needed. Otherwise return it unchanged.
          Return a JSON object:
          {
            "changed": true/false,
            "greeting": "Motivating message",
            "schedule": ["Schedule blocks"],
            "focusHighlight": "Primary focus"
          }
          Output ONLY raw JSON.
        `;
                let aiResponseResult = await llm.generateContentWithMetrics({
                    prompt,
                    subsystem: 'orchestration',
                    priority: eventRow.priority,
                });
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
                    await tx.update(nodes)
                        .set({ content: updatedContent, updatedAt: new Date() })
                        .where(eq(nodes.id, currentPlan.id));
                    // Enqueue notification using insertEvent helper
                    await insertEvent(tx, {
                        userId,
                        eventType: 'push_notification_requested',
                        payload: {
                            title: 'Plan Updated',
                            body: `Your daily plan was adjusted: ${parsed.focusHighlight}`,
                            type: 'plan_updated',
                        },
                        priority: 'normal',
                    });
                }
                // Complete the triggering event
                await tx.execute(sql `
          UPDATE events SET 
            processing_status = 'completed',
            estimated_cost = ${estimatedCost},
            token_usage = ${tokenUsage}
          WHERE user_id = ${userId}
          AND event_type = 'plan_update_requested'
          AND processing_status IN ('pending', 'processing', 'retrying')
        `);
                await insertEvent(tx, {
                    userId,
                    eventType: 'plan_update_processed',
                    payload: { sourcePlanUpdateId: eventId },
                });
                CognitionLogger.log({
                    subsystem: 'orchestration',
                    action: 'plan_updated',
                    userId,
                    outputs: { changed: parsed.changed, highlight: parsed.focusHighlight },
                    latencyMs: Date.now() - startTime,
                    reason: `Evaluated reactive thoughts and updated daily plan node for user ${userId}`,
                });
            }
            return true;
        });
        if (!lockAcquired) {
            await db.execute(sql `
        UPDATE events
        SET processing_status = 'retrying'
        WHERE id = ${eventId}
      `);
        }
    }
    catch (e) {
        const currentRetry = (eventRow.retry_count || 0) + 1;
        const isDlq = currentRetry >= MAX_RETRIES;
        const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
        const errorMessage = e?.stack || e?.message || String(e);
        await db.execute(sql `
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);
        if (isDlq) {
            console.error(`[Orchestrator] Event ${eventId} moved to DLQ. Error: ${errorMessage}`);
        }
        else {
            console.warn(`[Orchestrator] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
        }
    }
}
async function generatePlanForUser(userId) {
    const startTime = Date.now();
    const recentMemories = await db.execute(sql `
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'memory'
    ORDER BY created_at DESC LIMIT 10
  `);
    const actionItems = await db.execute(sql `
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'action_item'
    ORDER BY created_at DESC LIMIT 10
  `);
    const activeProjects = await db.execute(sql `
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'project'
    ORDER BY created_at DESC LIMIT 5
  `);
    const recentResearch = await db.execute(sql `
    SELECT content FROM nodes
    WHERE user_id = ${userId} AND node_type = 'research'
    ORDER BY created_at DESC LIMIT 3
  `);
    const activeTasks = await db.execute(sql `
    SELECT t.content as task, g.content as goal
    FROM nodes t
    JOIN edges e ON e.source_node_id = t.id
    JOIN nodes g ON e.target_node_id = g.id
    WHERE t.node_type = 'task' AND g.node_type = 'goal' AND t.user_id = ${userId}
    LIMIT 10
  `);
    const memoriesText = recentMemories.rows.map((r) => `- ${r.content}`).join('\n');
    const actionsText = actionItems.rows.map((r) => `- ${r.content}`).join('\n');
    const projectsText = activeProjects.rows.map((r) => r.content).join(', ');
    const researchText = recentResearch.rows.map((r) => `- ${r.content}`).join('\n');
    const tasksText = activeTasks.rows.map((r) => `[Goal: ${r.goal}] ${r.task}`).join('\n');
    const prompt = `
    Generate Daily Focus Plan.
    Recent:
    ${memoriesText}
    Pending:
    ${actionsText}
    Projects:
    ${projectsText}
    Tasks:
    ${tasksText}
    Research:
    ${researchText}
    Return JSON:
    { "greeting": "...", "schedule": [...], "focusHighlight": "..." }
  `;
    let aiResponseResult = await llm.generateContentWithMetrics({
        prompt,
        subsystem: 'orchestration',
        priority: 'normal',
    });
    const parsed = cleanAndParseJson(aiResponseResult.text);
    const planContent = JSON.stringify(parsed);
    const promptTokens = aiResponseResult.usage?.promptTokens || 0;
    const completionTokens = aiResponseResult.usage?.completionTokens || 0;
    const estimatedCost = (promptTokens * 0.000075 + completionTokens * 0.0003) / 1000;
    const tokenUsage = promptTokens + completionTokens;
    const existingPlan = await getTodaysPlan(userId);
    await db.transaction(async (tx) => {
        if (existingPlan) {
            await tx.update(nodes)
                .set({ content: planContent, updatedAt: new Date() })
                .where(eq(nodes.id, existingPlan.id));
        }
        else {
            await tx.insert(nodes).values({
                userId,
                nodeType: 'daily_plan',
                content: planContent,
            });
        }
        await insertEvent(tx, {
            userId,
            eventType: 'plan_generated',
            payload: { plan: parsed },
            estimatedCost,
            tokenUsage
        });
    });
    CognitionLogger.log({
        subsystem: 'orchestration',
        action: 'plan_generated',
        userId,
        outputs: { highlight: parsed.focusHighlight },
        latencyMs: Date.now() - startTime,
        reason: `Generated scheduled focus plan node for user ${userId}`,
    });
}
async function getTodaysPlan(userId) {
    const result = await db.execute(sql `
    SELECT id, content, updated_at FROM nodes
    WHERE user_id = ${userId}
    AND node_type = 'daily_plan'
    AND created_at::date = CURRENT_DATE
    ORDER BY created_at DESC
    LIMIT 1
  `);
    const row = result.rows[0];
    if (!row)
        return null;
    return {
        id: row.id,
        content: row.content,
        updated_at: row.updated_at
    };
}
//# sourceMappingURL=cognitive_orchestrator.js.map