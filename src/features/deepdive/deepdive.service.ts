import { db } from '../../db/index.js';
import { nodes, events, edges } from '../../db/schema.js';
import { sql, eq, and } from 'drizzle-orm';
import { llm } from '../../services/llm.service.js';
import { incrementUsage } from '../../core/middlewares/quota.middleware.js';

export class DeepDiveService {
  async getThoughtHistory(userId: string, rawThoughtId: string) {
    // 1. Verify thought belongs to user
    const thoughtQuery = await db.execute(sql`
      SELECT id, content FROM nodes 
      WHERE id = ${rawThoughtId} AND user_id = ${userId} AND node_type = 'raw_thought'
    `);
    const rawThought = thoughtQuery.rows[0];
    if (!rawThought) throw new Error('Thought not found');

    // 2. Fetch the current summary memory node linked to this thought
    const summaryQuery = await db.execute(sql`
      SELECT n.id, n.content 
      FROM nodes n
      JOIN edges e ON e.source_node_id = n.id
      WHERE e.target_node_id = ${rawThoughtId} 
      AND e.relation_type = 'summarizes' 
      AND n.node_type = 'memory'
      LIMIT 1
    `);
    const summaryNode = summaryQuery.rows[0];

    // 3. Fetch past conversation turns for this thought
    const historyQuery = await db.execute(sql`
      SELECT n.content, n.metadata 
      FROM nodes n
      JOIN edges e ON e.source_node_id = n.id
      WHERE e.target_node_id = ${rawThoughtId} 
      AND e.relation_type = 'discusses' 
      AND n.node_type = 'conversation_turn'
      ORDER BY n.created_at ASC
    `);

    const history = historyQuery.rows.map(r => ({
      role: (r.metadata as any)?.role || 'user',
      content: r.content
    }));

    return {
      rawThought: rawThought.content,
      summary: summaryNode?.content || '',
      history
    };
  }

  async chatWithThought(userId: string, rawThoughtId: string, message: string) {
    // 1. Verify thought belongs to user
    const thoughtQuery = await db.execute(sql`
      SELECT id, content FROM nodes 
      WHERE id = ${rawThoughtId} AND user_id = ${userId} AND node_type = 'raw_thought'
    `);
    const rawThought = thoughtQuery.rows[0];
    if (!rawThought) throw new Error('Thought not found');

    // 2. Fetch the current summary memory node linked to this thought
    const summaryQuery = await db.execute(sql`
      SELECT n.id, n.content 
      FROM nodes n
      JOIN edges e ON e.source_node_id = n.id
      WHERE e.target_node_id = ${rawThoughtId} 
      AND e.relation_type = 'summarizes' 
      AND n.node_type = 'memory'
      LIMIT 1
    `);
    const summaryNode = summaryQuery.rows[0];

    // 3. Fetch past conversation turns for this thought
    const historyQuery = await db.execute(sql`
      SELECT n.content, n.metadata 
      FROM nodes n
      JOIN edges e ON e.source_node_id = n.id
      WHERE e.target_node_id = ${rawThoughtId} 
      AND e.relation_type = 'discusses' 
      AND n.node_type = 'conversation_turn'
      ORDER BY n.created_at ASC
    `);
    
    let chatHistory = historyQuery.rows.map(r => `${(r.metadata as any)?.role === 'user' ? 'User' : 'AION'}: ${r.content}`).join('\n');

    // 4. Generate AI response and new summary
    const prompt = `
      You are AION, a proactive Second Brain. The user is deep-diving into a specific thought.
      
      Original Raw Thought: "${rawThought.content}"
      Current AI Summary: "${summaryNode?.content || 'No summary yet.'}"
      
      Chat History:
      ${chatHistory || 'No previous history.'}
      
      User's new message: "${message}"
      
      Tasks:
      1. Respond directly to the user's message as an insightful AI assistant.
      2. If this new message changes or evolves the understanding of the original thought, provide an updated, completely overwritten 'Current AI Summary' that incorporates this new realization. If the thought hasn't fundamentally changed, just return the exact same current summary.
      
      Return a JSON object:
      {
        "response": "Your conversational response to the user",
        "new_summary": "The completely rewritten summary incorporating new insights (or the old one if no change needed)"
      }
      Output ONLY raw JSON.
    `;

    const aiResponseRaw = await llm.generateContent({ prompt });
    const startIdx = aiResponseRaw.indexOf('{');
    const endIdx = aiResponseRaw.lastIndexOf('}');
    const parsed = JSON.parse(aiResponseRaw.substring(startIdx, endIdx + 1));

    // 5. Save everything in a transaction
    await db.transaction(async (tx) => {
      // Save User Message
      const [userTurn] = await tx.insert(nodes).values({
        userId,
        nodeType: 'conversation_turn',
        content: message,
        metadata: { role: 'user' }
      }).returning();

      // Save AI Response
      const [aiTurn] = await tx.insert(nodes).values({
        userId,
        nodeType: 'conversation_turn',
        content: parsed.response,
        metadata: { role: 'assistant' }
      }).returning();

      if (userTurn && aiTurn) {
        await tx.insert(edges).values([
          { sourceNodeId: userTurn.id, targetNodeId: rawThoughtId, relationType: 'discusses' },
          { sourceNodeId: aiTurn.id, targetNodeId: rawThoughtId, relationType: 'discusses' }
        ]);
      }

      // Overwrite Summary if it changed
      if (summaryNode && summaryNode.content !== parsed.new_summary) {
        const newEmbedding = await llm.embedContent(parsed.new_summary);
        await tx.update(nodes)
          .set({ content: parsed.new_summary, embedding: newEmbedding, updatedAt: new Date() })
          .where(eq(nodes.id, summaryNode.id as string));
        
        await tx.insert(events).values({
          userId,
          eventType: 'thought_updated',
          payload: { rawThoughtId, oldSummary: summaryNode.content, newSummary: parsed.new_summary }
        });
      }

      // Log deep dive event
      await tx.insert(events).values({
        userId,
        eventType: 'deep_dive_chat',
        payload: { rawThoughtId, message, response: parsed.response }
      });
    });

    await incrementUsage(userId);
    return { response: parsed.response, updatedSummary: parsed.new_summary };
  }
}
