import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { nodes } from '../db/schema.ts';
import { llm } from '../services/llm.service.ts';
import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, query } = req.body;

    if (!userId || !query) {
      return res.status(400).json({ error: 'Missing required fields: userId, query' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    console.log(`Executing search for query: "${query}"`);

    // 1. Embed the search query
    const queryEmbedding = await llm.embedContent(query);

    // 2. Perform Vector Search (Cosine Similarity)
    const similarNodes = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        distance: cosineDistance(nodes.embedding, queryEmbedding),
      })
      .from(nodes)
      .where(eq(nodes.nodeType, 'memory'))
      .orderBy(cosineDistance(nodes.embedding, queryEmbedding))
      .limit(5);

    if (similarNodes.length === 0) {
      return res.json({ answer: "I couldn't find any relevant memories for that." });
    }

    // 3. Graph Traversal: Fetch connected Projects and Entities
    const memoryNodeIds = similarNodes.map(n => n.id);
    const connectedNodesQuery = await db.execute(sql`
      SELECT e.source_node_id, n.node_type, n.content, e.relation_type
      FROM edges e
      JOIN nodes n ON e.target_node_id = n.id
      WHERE e.source_node_id = ANY(ARRAY[${sql.join(memoryNodeIds, sql`, `)}]::uuid[])
    `);

    // Group connections by memory
    const connectionsByMemory: Record<string, string[]> = {};
    for (const row of connectedNodesQuery.rows) {
      const sourceId = row.source_node_id as string;
      const type = row.node_type as string;
      const content = row.content as string;
      
      if (!connectionsByMemory[sourceId]) {
        connectionsByMemory[sourceId] = [];
      }
      connectionsByMemory[sourceId].push(`[${type.toUpperCase()}: ${content}]`);
    }

    // 4. Prepare Rich Context
    const contextStr = similarNodes.map((n, i) => {
      const connections = connectionsByMemory[n.id]?.join(', ') || 'No connected tags.';
      return `Memory ${i + 1}: ${n.content}\nRelated Context: ${connections}`;
    }).join('\n\n');
    
    // 5. Synthesize Answer using LLM
    const prompt = `
      You are AION, the user's external brain and cognitive companion.
      The user asked: "${query}"
      
      Here are the most relevant memories retrieved from their cognitive graph:
      ${contextStr}
      
      Answer their question concisely based ONLY on these memories. 
      If the memories don't contain the answer, say you don't know based on current records.
      Speak directly to the user (e.g., "You thought about...").
    `;

    const answer = await llm.generateContent({ prompt });

    return res.json({
      answer,
      context: similarNodes
    });

  } catch (error) {
    console.error('Error during search:', error);
    return res.status(500).json({ error: 'Internal server error during search' });
  }
});

export default router;
