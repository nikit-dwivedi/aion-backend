import { db } from '../db/index.js';
import { events, nodes, edges, users } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Planner Worker has two jobs:
 * 1. Scheduled: Generate a fresh daily_plan at ~6:00 AM in each user's local timezone.
 * 2. Reactive: When a plan_update_requested event fires, re-evaluate and overwrite the plan.
 */
export const startPlannerWorker = () => {
  console.log('Starting Daily Plan Worker...');

  // Check for scheduled plan generation every 5 minutes
  setInterval(async () => {
    try {
      await generateScheduledPlans();
    } catch (error) {
      console.error('[Planner] Scheduled generation error:', error);
    }
  }, 5 * 60 * 1000);

  // Check for reactive plan update requests every 20 seconds
  setInterval(async () => {
    try {
      await processReactivePlanUpdates();
    } catch (error) {
      console.error('[Planner] Reactive update error:', error);
    }
  }, 20000);
};

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

// ─── Reactive Plan Updates ───────────────────────────────────────────────────

async function processReactivePlanUpdates() {
  if (!llm.isConfigured) return;

  const pending = await db.execute(sql`
    SELECT e1.* FROM events e1
    WHERE e1.event_type = 'plan_update_requested'
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'plan_update_processed'
      AND e2.payload->>'sourcePlanUpdateId' = e1.id::text
    )
    LIMIT 1
  `);

  if (pending.rows.length === 0) return;

  for (const row of pending.rows) {
    const eventId = row.id as string;
    const userId = row.user_id as string;
    const payload = row.payload as any;

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
        const startIdx = aiResponse.indexOf('{');
        const endIdx = aiResponse.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1) {
          aiResponse = aiResponse.substring(startIdx, endIdx + 1);
        }

        const parsed = JSON.parse(aiResponse);

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

      // Mark as processed
      await db.insert(events).values({
        userId,
        eventType: 'plan_update_processed',
        payload: { sourcePlanUpdateId: eventId },
      });
    } catch (e) {
      console.error(`[Planner] Failed reactive update for event ${eventId}:`, e);
      // Mark as processed even on failure to avoid infinite loops
      await db.insert(events).values({
        userId,
        eventType: 'plan_update_processed',
        payload: { sourcePlanUpdateId: eventId, error: true },
      });
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
  const startIdx = aiResponse.indexOf('{');
  const endIdx = aiResponse.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1) {
    aiResponse = aiResponse.substring(startIdx, endIdx + 1);
  }

  const parsed = JSON.parse(aiResponse);
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
