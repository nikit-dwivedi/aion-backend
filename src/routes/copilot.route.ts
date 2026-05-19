import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges, events } from '../db/schema.ts';
import { llm } from '../services/llm.service.ts';
import { eq, desc, sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// POST /api/copilot/generate
router.post('/generate', async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });

    const userId = (req as any).userId;
    const recentMemories = await db.select({ id: nodes.id, content: nodes.content, createdAt: nodes.createdAt }).from(nodes).where(eq(nodes.nodeType, 'memory')).orderBy(desc(nodes.createdAt)).limit(30);
    if (recentMemories.length < 3) return res.json({ insights: [] });

    const allProjects = await db.select({ content: nodes.content }).from(nodes).where(eq(nodes.nodeType, 'project'));
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
      await db.insert(nodes).values({ userId, nodeType: 'insight', content: JSON.stringify(ins), metadata: { generatedAt: new Date().toISOString(), type: ins.type } });
    }

    return res.json({ insights: enriched });
  } catch (error) {
    console.error('Copilot generate error:', error);
    return res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// GET /api/copilot/insights
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const insightNodes = await db.select({ id: nodes.id, content: nodes.content, createdAt: nodes.createdAt }).from(nodes).where(eq(nodes.nodeType, 'insight')).orderBy(desc(nodes.createdAt)).limit(20);
    const insights = insightNodes.map(n => {
      try { return { id: n.id, ...JSON.parse(n.content), createdAt: n.createdAt }; }
      catch { return { id: n.id, type: 'pattern', title: 'Insight', body: n.content, createdAt: n.createdAt }; }
    });
    return res.json({ insights });
  } catch (error) {
    console.error('Fetch insights error:', error);
    return res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// GET /api/copilot/nudge
router.get('/nudge', async (req: Request, res: Response) => {
  try {
    const insightNodes = await db.select({ id: nodes.id, content: nodes.content }).from(nodes).where(eq(nodes.nodeType, 'insight')).orderBy(desc(nodes.createdAt)).limit(10);
    if (insightNodes.length === 0) return res.json({ nudge: null });

    // Pick a random recent insight
    const randomInsight = insightNodes[Math.floor(Math.random() * insightNodes.length)];
    try {
      const parsed = JSON.parse(randomInsight.content);
      return res.json({ nudge: { title: parsed.title, body: parsed.body } });
    } catch {
      return res.json({ nudge: null });
    }
  } catch (error) {
    console.error('Nudge error:', error);
    return res.status(500).json({ error: 'Failed to fetch nudge' });
  }
});

// POST /api/copilot/chat
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, conversationHistory } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });

    const recentMemories = await db.select({ content: nodes.content }).from(nodes).where(eq(nodes.nodeType, 'memory')).orderBy(desc(nodes.createdAt)).limit(20);
    const memCtx = recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    const historyText = (conversationHistory || []).map((h: any) => `${h.role === 'user' ? 'User' : 'AION'}: ${h.content}`).join('\n');

    const prompt = `You are AION, the user's cognitive companion with deep knowledge of their thoughts.

User's recent memories:
${memCtx}

${historyText ? `Previous conversation:\n${historyText}\n` : ''}
User says: "${message}"

Respond as AION — warm, insightful, referencing specific memories when relevant. 2-4 sentences. Speak directly to user.`;

    const reply = await llm.generateContent({ prompt });
    return res.json({ reply });
  } catch (error) {
    console.error('Copilot chat error:', error);
    return res.status(500).json({ error: 'Failed to process chat' });
  }
});

export default router;
