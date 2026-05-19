import { CopilotRepository } from './copilot.repository.js';
import { llm } from '../../services/llm.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class CopilotService {
  static async generateInsights(userId: string) {
    if (!env.GEMINI_API_KEY) throw new AppError('GEMINI_API_KEY not configured.', 500);

    const recentMemories = await CopilotRepository.getRecentMemories(30);
    if (recentMemories.length < 3) return [];

    const allProjects = await CopilotRepository.getAllProjects();
    const memoriesText = recentMemories.map((m, i) => `[M${i + 1}] [${m.createdAt?.toISOString?.() ?? ''}] ${m.content}`).join('\n');
    const projectsText = allProjects.map(p => p.content).join(', ');

    const prompt = `You are AION, an advanced cognitive copilot analyzing patterns in user thoughts.

Here are user memories (labeled [M1], [M2], etc.):
${memoriesText}

Known projects: ${projectsText || 'None'}

Produce 3-5 proactive insights. Types: "pattern", "reminder", "connection", "suggestion".
Return JSON array with: type, title (max 10 words), body (1-2 sentences), urgency ("low"/"medium"/"high"), sources (array of memory index numbers this insight is based on, e.g. [1, 5, 12]).
Output ONLY raw JSON array.`;

    let aiResponse = await llm.generateContent({ prompt });
    const si = aiResponse.indexOf('['), ei = aiResponse.lastIndexOf(']');
    if (si !== -1 && ei !== -1) aiResponse = aiResponse.substring(si, ei + 1);
    
    const insights = JSON.parse(aiResponse);

    const enriched = insights.map((ins: any) => {
      const sourceMemories = (ins.sources || []).map((idx: number) => {
        const m = recentMemories[idx - 1];
        return m ? { id: m.id, content: m.content } : null;
      }).filter(Boolean);
      return { ...ins, sourceMemories };
    });

    for (const ins of enriched) {
      await CopilotRepository.insertInsight(userId, ins);
    }

    return enriched;
  }

  static async getInsights() {
    const insightNodes = await CopilotRepository.getInsights(20);
    return insightNodes.map(n => {
      try { return { id: n.id, ...JSON.parse(n.content), createdAt: n.createdAt }; }
      catch { return { id: n.id, type: 'pattern', title: 'Insight', body: n.content, createdAt: n.createdAt }; }
    });
  }

  static async getNudge() {
    const insightNodes = await CopilotRepository.getInsights(10);
    if (insightNodes.length === 0) return null;

    const randomInsight = insightNodes[Math.floor(Math.random() * insightNodes.length)];
    if (!randomInsight) return null;
    
    try {
      const parsed = JSON.parse(randomInsight.content);
      return { title: parsed.title, body: parsed.body };
    } catch {
      return null;
    }
  }

  static async chat(message: string, conversationHistory: any[]) {
    if (!env.GEMINI_API_KEY) throw new AppError('GEMINI_API_KEY not configured.', 500);

    const recentMemories = await CopilotRepository.getRecentMemories(20);
    const memCtx = recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    const historyText = (conversationHistory || []).map((h: any) => `${h.role === 'user' ? 'User' : 'AION'}: ${h.content}`).join('\n');

    const prompt = `You are AION, the user's cognitive companion with deep knowledge of their thoughts.

User's recent memories:
${memCtx}

${historyText ? `Previous conversation:\n${historyText}\n` : ''}
User says: "${message}"

Respond as AION — warm, insightful, referencing specific memories when relevant. 2-4 sentences. Speak directly to user.`;

    return await llm.generateContent({ prompt });
  }
}
