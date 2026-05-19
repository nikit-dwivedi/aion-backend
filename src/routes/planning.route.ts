import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes, edges } from '../db/schema.ts';
import { llm } from '../services/llm.service.ts';
import { eq, desc, sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Helper to get or create a node
async function resolveNode(userId: string, nodeType: string, content: string, tx: any = db) {
  const existing = await tx.execute(sql`
    SELECT id FROM nodes 
    WHERE node_type = ${nodeType} AND lower(content) = lower(${content})
    LIMIT 1
  `);
  
  if (existing?.rows?.length > 0) {
    return existing.rows[0].id as string;
  }
  
  const [newNode] = await tx.insert(nodes).values({
    userId,
    nodeType,
    content
  }).returning();
  
  return newNode.id;
}

// POST /api/planning/breakdown - Generate goal breakdown
router.post('/breakdown', async (req: Request, res: Response) => {
  try {
    const { userId, goal } = req.body;
    if (!userId || !goal) {
      return res.status(400).json({ error: 'Missing userId or goal' });
    }

    // 1. Fetch user's active projects for context
    const allProjects = await db
      .select({ content: nodes.content })
      .from(nodes)
      .where(eq(nodes.nodeType, 'project'));
    
    const projectsText = allProjects.map(p => p.content).join(', ');

    // 2. Generate breakdown using LLM
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

    // 3. Save to graph
    await db.transaction(async (tx) => {
      // Create Goal Node
      const [goalNode] = await tx.insert(nodes).values({
        userId,
        nodeType: 'goal',
        content: breakdown.goalName,
        metadata: { status: 'active', originalRequest: goal }
      }).returning();

      if (!goalNode?.id) {
        throw new Error('Failed to create goal node');
      }

      // Link to Project if relevant
      if (breakdown.relatedProject) {
        const projectId = await resolveNode(userId, 'project', breakdown.relatedProject, tx);
        await tx.insert(edges).values({
          sourceNodeId: goalNode.id,
          targetNodeId: projectId,
          relationType: 'belongs_to',
        });
      }

      // Create Task Nodes & Dependencies
      let previousTaskId = null;
      for (const step of breakdown.steps) {
        const [taskNode] = await tx.insert(nodes).values({
          userId,
          nodeType: 'task',
          content: step,
          metadata: { status: 'pending' }
        }).returning();

        if (!taskNode?.id) {
          throw new Error('Failed to create task node');
        }

        // Link task to goal
        await tx.insert(edges).values({
          sourceNodeId: taskNode.id,
          targetNodeId: goalNode.id,
          relationType: 'belongs_to',
        });

        // Sequence dependency (A blocks B)
        if (previousTaskId) {
          await tx.insert(edges).values({
            sourceNodeId: previousTaskId, // Prev task
            targetNodeId: taskNode.id,    // Blocks current task
            relationType: 'blocks',
          });
        }
        previousTaskId = taskNode.id;
      }
    });

    return res.json({ breakdown });
  } catch (error) {
    console.error('Error generating breakdown:', error);
    return res.status(500).json({ error: 'Failed to generate goal breakdown' });
  }
});

// POST /api/planning/schedule - Generate daily schedule
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // 1. Fetch active goals and tasks
    const activeTasks = await db.execute(sql`
      SELECT t.content as task, g.content as goal
      FROM nodes t
      JOIN edges e ON e.source_node_id = t.id
      JOIN nodes g ON e.target_node_id = g.id
      WHERE t.node_type = 'task' AND g.node_type = 'goal'
      LIMIT 10
    `);

    // 2. Fetch recent copilot insights (reminders/suggestions)
    const recentInsights = await db
      .select({ content: nodes.content })
      .from(nodes)
      .where(eq(nodes.nodeType, 'insight'))
      .orderBy(desc(nodes.createdAt))
      .limit(5);

    const contextTasks = activeTasks.rows.map(r => `[Goal: ${r.goal}] Task: ${r.task}`).join('\n');
    const contextInsights = recentInsights.map(i => {
      try {
        const parsed = JSON.parse(i.content);
        return `${parsed.type.toUpperCase()}: ${parsed.title} - ${parsed.body}`;
      } catch { return ''; }
    }).filter(Boolean).join('\n');

    // 3. Generate schedule
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
    
    const schedule = JSON.parse(aiResponse);

    return res.json({ schedule });
  } catch (error) {
    console.error('Error generating schedule:', error);
    return res.status(500).json({ error: 'Failed to generate schedule' });
  }
});

export default router;
