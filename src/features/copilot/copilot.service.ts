import { CopilotRepository } from './copilot.repository.js';
import { llm } from '../../services/llm.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
import { cleanAndParseJson } from '../../core/utils.js';

export class CopilotService {
  static async generateInsights(userId: string) {
    if (!llm.isConfigured) throw new AppError('LLM service not configured.', 500);

    const recentMemories = await CopilotRepository.getRecentMemories(userId, 30);
    if (recentMemories.length < 3) return [];

    const allProjects = await CopilotRepository.getAllProjects(userId);
    const memoriesText = recentMemories.map((m, i) => `[Memory #${i + 1}] [${m.createdAt?.toISOString?.() ?? ''}] ${m.content}`).join('\n');
    const projectsText = allProjects.map(p => p.content).join(', ');

    const prompt = `You are AION, an advanced cognitive copilot analyzing patterns in user thoughts.

Here are user memories (numbered 1, 2, 3, etc.):
${memoriesText}

Known projects: ${projectsText || 'None'}

Produce 3-5 proactive insights. Types: "pattern", "reminder", "connection", "suggestion".
Return a JSON array. Each element must have these fields:
- "type": one of "pattern", "reminder", "connection", "suggestion"
- "title": string, max 10 words
- "body": string, 1-2 sentences
- "urgency": one of "low", "medium", "high"
- "sources": array of INTEGER memory numbers (e.g. [1, 5, 12]). IMPORTANT: use plain integers only, do NOT use prefixes like "M1" or "#1" — just the number.

Output ONLY the raw JSON array, no markdown, no explanation.`;

    let aiResponse = await llm.generateContent({ prompt });

    // Sanitize: strip M/m/# prefixes from sources arrays before parsing
    // Handles cases like "sources": [M2, M3] or "sources": ["M2", "M3"]
    aiResponse = aiResponse.replace(
      /"sources"\s*:\s*\[([^\]]*)\]/g,
      (_match: string, inner: string) => {
        const cleaned = inner.replace(/["']?\s*[Mm#](\d+)\s*["']?/g, '$1');
        return `"sources": [${cleaned}]`;
      }
    );

    // Extract JSON array brackets
    const si = aiResponse.indexOf('['), ei = aiResponse.lastIndexOf(']');
    if (si !== -1 && ei !== -1) aiResponse = aiResponse.substring(si, ei + 1);
    
    let insights: any[];
    try {
      insights = JSON.parse(aiResponse);
    } catch {
      // If array parse fails, try wrapping in array after object parse
      const obj = cleanAndParseJson(aiResponse);
      insights = Array.isArray(obj) ? obj : [obj];
    }

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

  static async getInsights(userId: string) {
    const insightNodes = await CopilotRepository.getInsights(userId, 20);
    return insightNodes.map(n => {
      try { return { id: n.id, ...JSON.parse(n.content), createdAt: n.createdAt }; }
      catch { return { id: n.id, type: 'pattern', title: 'Insight', body: n.content, createdAt: n.createdAt }; }
    });
  }

  static async getNudge(userId: string) {
    if (!llm.isConfigured) return null;

    const recentMemories = await CopilotRepository.getRecentMemories(userId, 5);
    if (recentMemories.length === 0) return null;

    const memCtx = recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    
    const prompt = `You are AION, a cognitive copilot. 
Analyze these 5 recent thoughts from the user:
${memCtx}

Generate a single, deep, provocative "Socratic Question" designed to spark journaling and reflection. 
It should connect two of their ideas or challenge a contradiction.
Return a JSON object with exactly two fields:
- title: A very short hook (e.g. "Focus & Burnout", "Contradiction in goals")
- body: The socratic question itself (1-2 sentences).
Output ONLY raw JSON without markdown formatting.`;

    try {
      const aiResponse = await llm.generateContent({ prompt });
      return cleanAndParseJson(aiResponse);
    } catch {
      return null;
    }
  }

  static async chat(userId: string, message: string, conversationHistory: any[]) {
    if (!llm.isConfigured) throw new AppError('LLM service not configured.', 500);

    const recentMemories = await CopilotRepository.getRecentMemories(userId, 20);
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
