import { db } from './db/index.ts';
import { events, nodes, edges } from './db/schema.ts';
import { sql } from 'drizzle-orm';
import { llm } from './services/llm.service.ts';
import dotenv from 'dotenv';

dotenv.config();

// Utility: delay for general backoff
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
  // If provider is gemini but no key, warn and pause.
  if (process.env.LLM_PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set but LLM_PROVIDER is gemini. Worker paused.');
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
      // 1. Generate Summary, Entities, and Project via Gemini
      const promptInstruction = `
        Return a JSON object with exactly these fields:
        - summary: A concise summary of the thought.
        - project: A single string representing the broader project or category this thought belongs to (e.g., "AION Development", "Fitness", "E-commerce App"). Keep it short and generic.
        - entities: An array of strings representing key specific entities (tools, technologies, locations, concepts).
        - people: An array of strings representing people mentioned by name (first name, full name, or role like "my manager").
        - sentiment: One of "positive", "neutral", "negative", "anxious", "excited", "reflective".
        - mood_score: An integer from 1 to 10 (1=very negative, 5=neutral, 10=very positive).
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

      // 2. Generate Embedding
      const embeddingVector = await llm.embedContent(parsed.summary);

      // 3. Database Transaction
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

        if (!memoryNode) {
          throw new Error('Failed to insert memory node');
        }

        // Helper: resolve or create a node (deduplication)
        const resolveNode = async (nodeType: string, content: string) => {
          const existing = await tx.execute(sql`
            SELECT id FROM nodes 
            WHERE node_type = ${nodeType} AND lower(content) = lower(${content})
            LIMIT 1
          `);
          
          if (existing?.rows?.length > 0) {
            return existing?.rows?.[0]?.id as string;
          }
          
          const [newNode] = await tx.insert(nodes).values({
            userId,
            nodeType,
            content
          }).returning();
          
          if (!newNode) {
            throw new Error('Failed to insert node');
          }

          return newNode.id;
        };

        // Link Project Node
        if (parsed.project) {
          const projectId = await resolveNode('project', parsed.project);
          await tx.insert(edges).values({
            sourceNodeId: memoryNode.id,
            targetNodeId: projectId,
            relationType: 'belongs_to',
          });
        }

        // Link Entity Nodes
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

        // Link Person Nodes (Relationship Graph)
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

        // Mark as processed
        await tx.insert(events).values({
          userId,
          eventType: 'memory_processed',
          payload: { originalEventId: eventId, summary: parsed.summary }
        });
      });
      
      console.log(`Successfully processed event ${eventId}`);
      await delay(2000);
    } catch (e) {
      console.error(`Failed to process event ${eventId}:`, e);
    }
  }
}
