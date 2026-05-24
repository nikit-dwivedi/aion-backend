import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { env } from '../config/env.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const startWorker = () => {
  console.log('Starting AI Processing Worker...');
  
  setInterval(async () => {
    try {
      await processPendingEvents();
    } catch (error) {
      console.error('Worker error:', error);
    }
  }, 15000);
};

async function processPendingEvents() {
  if (!llm.isConfigured) {
    console.error('LLM service is not configured. Worker paused.');
    return;
  }

  const pendingEvents = await db.execute(sql`
    SELECT e1.* FROM events e1 
    WHERE e1.event_type = 'memory_created' 
    AND NOT EXISTS (
      SELECT 1 FROM events e2 
      WHERE e2.event_type = 'memory_processed' 
      AND e2.payload->>'originalEventId' = e1.id::text
    )
    LIMIT 3
  `);

  if (pendingEvents.rows.length === 0) return;

  for (const row of pendingEvents.rows) {
    const eventId = row.id as string;
    const userId = row.user_id as string;
    const payload = row.payload as any;
    
    console.log(`Processing event ${eventId}...`);
    
    try {
      const recentMems = await db.execute(sql`
        SELECT content FROM nodes 
        WHERE node_type = 'memory' AND user_id = ${userId}
        ORDER BY created_at DESC LIMIT 10
      `);
      const recentText = recentMems.rows.map((r, i) => `${i + 1}. ${r.content}`).join('\n');

      const promptInstruction = `
        You are AION, extracting structured metadata from a new thought.
        Here are the user's recent thoughts for context:
        ${recentText || 'None'}

        Return a JSON object with exactly these fields:
        - summary: A concise summary of the thought.
        - project: A single string representing the broader project or category this thought belongs to. Keep it short.
        - entities: An array of strings representing key specific entities.
        - people: An array of strings representing people mentioned by name.
        - contradictions: An array of strings representing entities or projects that this new thought actively contradicts or reverses based on the context. Empty array if none.
        - sentiment: One of "positive", "neutral", "negative", "anxious", "excited", "reflective".
        - mood_score: An integer from 1 to 10 (1=very negative, 5=neutral, 10=very positive).
        - requires_research: A boolean. true if this thought mentions a topic, concept, or question that could benefit from web research to provide more context or answer the user's curiosity. false otherwise.
        - research_query: If requires_research is true, a short web search query string (max 10 words) to find relevant information. null if false.
        Output ONLY raw JSON without markdown formatting.
      `;

      let aiResponse: string;

      if ((payload.type === 'audio' || payload.type === 'image') && payload.mediaBase64) {
        aiResponse = await llm.generateContent({
          systemInstruction: payload.type === 'audio' ? 'Listen to this audio thought.' : 'Analyze this image thought.',
          prompt: promptInstruction,
          mediaBuffer: payload.mediaBase64,
          mimeType: payload.mimeType,
        });
      } else {
        aiResponse = await llm.generateContent({
          prompt: `Analyze this thought: "${payload.content}"\n${promptInstruction}`
        });
      }
      
      const startIdx = aiResponse.indexOf('{');
      const endIdx = aiResponse.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        aiResponse = aiResponse.substring(startIdx, endIdx + 1);
      }
      
      const parsed = JSON.parse(aiResponse);
      const embeddingVector = await llm.embedContent(parsed.summary);

      await db.transaction(async (tx) => {
        const [memoryNode] = await tx.insert(nodes).values({
          userId,
          nodeType: 'memory',
          content: parsed.summary,
          embedding: embeddingVector,
          metadata: { 
            originalEventId: eventId, 
            rawContent: payload.content,
            sentiment: parsed.sentiment || 'neutral',
            moodScore: parsed.mood_score || 5,
          }
        }).returning();

        if (!memoryNode) throw new Error('Failed to insert memory node');

        const resolveNode = async (nodeType: string, content: string) => {
          const existing = await tx.execute(sql`
            SELECT id FROM nodes 
            WHERE node_type = ${nodeType} AND lower(content) = lower(${content})
            LIMIT 1
          `);
          
          if (existing?.rows?.length > 0) return existing?.rows?.[0]?.id as string;
          
          const [newNode] = await tx.insert(nodes).values({
            userId,
            nodeType,
            content
          }).returning();
          
          if (!newNode) throw new Error('Failed to insert node');
          return newNode.id;
        };

        if (parsed.project) {
          const projectId = await resolveNode('project', parsed.project);
          await tx.insert(edges).values({
            sourceNodeId: memoryNode.id,
            targetNodeId: projectId,
            relationType: 'belongs_to',
          });
        }

        if (parsed.entities && Array.isArray(parsed.entities)) {
          for (const entity of parsed.entities) {
            const entityId = await resolveNode('entity', entity);
            await tx.insert(edges).values({
              sourceNodeId: memoryNode.id,
              targetNodeId: entityId,
              relationType: 'mentions',
            });
          }
        }

        if (parsed.people && Array.isArray(parsed.people)) {
          for (const person of parsed.people) {
            const personId = await resolveNode('person', person);
            await tx.insert(edges).values({
              sourceNodeId: memoryNode.id,
              targetNodeId: personId,
              relationType: 'mentions_person',
            });
          }
        }

        if (parsed.contradictions && Array.isArray(parsed.contradictions)) {
          for (const contradiction of parsed.contradictions) {
            const cId = await resolveNode('entity', contradiction);
            await tx.insert(edges).values({
              sourceNodeId: memoryNode.id,
              targetNodeId: cId,
              relationType: 'contradicts',
            });
          }
        }

        await tx.insert(events).values({
          userId,
          eventType: 'memory_processed',
          payload: { originalEventId: eventId, summary: parsed.summary }
        });
      });
      
      console.log(`Successfully processed event ${eventId}`);

      // If research is needed, emit a research_requested event for the agent worker
      if (parsed.requires_research && parsed.research_query) {
        await db.insert(events).values({
          userId,
          eventType: 'research_requested',
          payload: { query: parsed.research_query, sourceEventId: eventId, sourceSummary: parsed.summary }
        });
        console.log(`Research requested: "${parsed.research_query}"`);
      }

      await delay(2000);
    } catch (e) {
      console.error(`Failed to process event ${eventId}:`, e);
    }
  }
}
