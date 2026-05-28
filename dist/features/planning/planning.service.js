import { PlanningRepository } from './planning.repository.js';
import { llm } from '../../services/llm.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
import { db } from '../../db/index.js';
import { nodes, events } from '../../db/schema.js';
import { sql } from 'drizzle-orm';
import { cleanAndParseJson } from '../../core/utils.js';
export class PlanningService {
    static async generateBreakdown(userId, goal) {
        if (!goal)
            throw new AppError('Missing goal', 400);
        const allProjects = await PlanningRepository.getActiveProjects(userId);
        const projectsText = allProjects.map(p => p.content).join(', ');
        const prompt = `
      You are AION, an advanced cognitive Life Operating System.
      The user has set a high-level goal: "${goal}"
      
      Known user projects: ${projectsText || 'None yet'}
      
      Break this goal down into 3-5 actionable sub-tasks or milestones.
      
      Return a JSON object with exactly these fields:
      - goalName: A clean, concise title for this goal.
      - steps: An array of strings representing the sequential milestones.
      - relatedProject: (optional) If this goal directly maps to one of the known projects, output the exact project name. Otherwise, leave null.

      Output ONLY raw JSON. No markdown.
    `;
        const aiResponse = await llm.generateContent({ prompt });
        const breakdown = cleanAndParseJson(aiResponse);
        await PlanningRepository.saveGoalBreakdown(userId, breakdown);
        return breakdown;
    }
    /**
     * Fetches the persisted daily plan for today. If none exists, generates one on-the-fly.
     */
    static async generateSchedule(userId) {
        // 1. Try to fetch today's persisted plan (instant)
        const existingPlan = await db.execute(sql `
      SELECT id, content, updated_at FROM nodes
      WHERE user_id = ${userId}
      AND node_type = 'daily_plan'
      AND created_at::date = CURRENT_DATE
      ORDER BY created_at DESC
      LIMIT 1
    `);
        if (existingPlan.rows.length > 0) {
            try {
                const firstRow = existingPlan.rows[0];
                if (firstRow && firstRow.content) {
                    return JSON.parse(firstRow.content);
                }
            }
            catch {
                // If content isn't valid JSON, fall through to regeneration
            }
        }
        // 2. No plan for today yet — generate one on-the-fly (fallback)
        const activeTasks = await PlanningRepository.getActiveTasks(userId);
        const recentInsights = await PlanningRepository.getRecentInsights(userId);
        const actionItems = await db.execute(sql `
      SELECT content FROM nodes
      WHERE user_id = ${userId} AND node_type = 'action_item'
      ORDER BY created_at DESC LIMIT 10
    `);
        const contextTasks = activeTasks.rows.map((r) => `[Goal: ${r.goal}] Task: ${r.task}`).join('\n');
        const contextInsights = recentInsights.map(i => {
            try {
                const parsed = JSON.parse(i.content);
                return `${parsed.type.toUpperCase()}: ${parsed.title} - ${parsed.body}`;
            }
            catch {
                return '';
            }
        }).filter(Boolean).join('\n');
        const actionsText = actionItems.rows.map((r) => `- ${r.content}`).join('\n');
        const prompt = `
      You are AION, generating a "Daily Focus Schedule" for the user.
      
      Current active tasks from goals:
      ${contextTasks || 'No active goal tasks yet.'}
      
      Pending action items (extracted from thoughts):
      ${actionsText || 'No pending action items.'}
      
      Recent AI Insights & Reminders:
      ${contextInsights || 'None.'}
      
      Generate a realistic, text-based daily plan with 3-5 key focus areas or time-blocks.
      Weave the active tasks, action items, and insights into a cohesive day plan.
      
      Return a JSON object with exactly these fields:
      - greeting: A short, motivating good morning message.
      - schedule: An array of strings representing the time-blocks or priorities (e.g., "Morning: Focus on X").
      - focusHighlight: A single string emphasizing the most important thing to get done today.

      Output ONLY raw JSON. No markdown.
    `;
        const aiResponse = await llm.generateContent({ prompt });
        const parsed = cleanAndParseJson(aiResponse);
        // Persist the generated plan so subsequent loads are instant
        await db.insert(nodes).values({
            userId,
            nodeType: 'daily_plan',
            content: JSON.stringify(parsed),
        });
        await db.insert(events).values({
            userId,
            eventType: 'plan_generated',
            payload: { plan: parsed },
        });
        return parsed;
    }
}
//# sourceMappingURL=planning.service.js.map