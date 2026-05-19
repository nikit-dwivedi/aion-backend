import { PlanningRepository } from './planning.repository.js';
import { llm } from '../../services/llm.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class PlanningService {
  static async generateBreakdown(userId: string, goal: string) {
    if (!goal) throw new AppError('Missing goal', 400);

    const allProjects = await PlanningRepository.getActiveProjects();
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

    let aiResponse = await llm.generateContent({ prompt });
    
    const startIdx = aiResponse.indexOf('{');
    const endIdx = aiResponse.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      aiResponse = aiResponse.substring(startIdx, endIdx + 1);
    }
    
    const breakdown = JSON.parse(aiResponse);

    await PlanningRepository.saveGoalBreakdown(userId, breakdown);

    return breakdown;
  }

  static async generateSchedule(userId: string) {
    const activeTasks = await PlanningRepository.getActiveTasks();
    const recentInsights = await PlanningRepository.getRecentInsights();

    const contextTasks = activeTasks.rows.map((r: any) => `[Goal: ${r.goal}] Task: ${r.task}`).join('\n');
    const contextInsights = recentInsights.map(i => {
      try {
        const parsed = JSON.parse(i.content);
        return `${parsed.type.toUpperCase()}: ${parsed.title} - ${parsed.body}`;
      } catch { return ''; }
    }).filter(Boolean).join('\n');

    const prompt = `
      You are AION, generating a "Daily Focus Schedule" for the user.
      
      Current active tasks from goals:
      ${contextTasks || 'No active goal tasks yet.'}
      
      Recent AI Insights & Reminders:
      ${contextInsights || 'None.'}
      
      Generate a realistic, text-based daily plan with 3-5 key focus areas or time-blocks.
      Weave the active tasks and insights into a cohesive day plan.
      
      Return a JSON object with exactly these fields:
      - greeting: A short, motivating good morning message.
      - schedule: An array of strings representing the time-blocks or priorities (e.g., "Morning: Focus on X").
      - focusHighlight: A single string emphasizing the most important thing to get done today.

      Output ONLY raw JSON. No markdown.
    `;

    let aiResponse = await llm.generateContent({ prompt });
    
    const startIdx = aiResponse.indexOf('{');
    const endIdx = aiResponse.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      aiResponse = aiResponse.substring(startIdx, endIdx + 1);
    }
    
    return JSON.parse(aiResponse);
  }
}
