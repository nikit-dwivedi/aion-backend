import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { env } from '../config/env.js';
import { incrementUsage } from '../core/middlewares/quota.middleware.js';
import { queueProvider } from '../core/queue.js';
import { cleanAndParseJson } from '../core/utils.js';
import { embeddingService } from '../services/embedding.service.js';
import { CognitionLogger } from '../core/observability.js';
import { insertEvent } from '../core/events.js';
import { LoopDetectionService } from '../services/loop_detection.service.js';

const MAX_RETRIES = 5;

export function isEventReadyForRetry(createdAt: Date, retryCount: number): boolean {
  if (retryCount === 0) return true;
  const backoffMs = Math.min(Math.pow(2, retryCount) * 5000, 24 * 60 * 60 * 1000);
  return Date.now() >= createdAt.getTime() + backoffMs;
}

/**
 * Start the LLM Extractor Worker.
 */
export const startWorker = () => {
  console.log('[Extractor] Starting AI Processing Worker (push-driven)...');

  // Subscriptions to critical and normal queues
  queueProvider.subscribe('critical_cognition_queue', async (msg) => {
    if (msg.eventType === 'memory_created') {
      try {
        await processEventById(msg.id);
      } catch (error) {
        console.error(`[Extractor] Critical Notification error for event ${msg.id}:`, error);
      }
    }
  });

  queueProvider.subscribe('normal_cognition_queue', async (msg) => {
    if (msg.eventType === 'memory_created') {
      try {
        await processEventById(msg.id);
      } catch (error) {
        console.error(`[Extractor] Normal Notification error for event ${msg.id}:`, error);
      }
    }
  });

  // Fallback periodic sweep
  setInterval(async () => {
    try {
      await sweepPendingEvents();
    } catch (error) {
      console.error('[Extractor] Sweep error:', error);
    }
  }, 60000);
};

async function sweepPendingEvents(): Promise<void> {
  const pendingEvents = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'memory_created'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY CASE WHEN priority = 'critical' THEN 5 WHEN priority = 'urgent' THEN 4 WHEN priority = 'high' THEN 4 WHEN priority = 'important' THEN 4 WHEN priority = 'normal' THEN 3 WHEN priority = 'background' THEN 2 ELSE 1 END DESC, created_at ASC
    LIMIT 5
  `);

  for (const row of pendingEvents.rows) {
    await processEventById(row.id as string);
  }
}

async function updateProgress(eventId: string, progress: string) {
  await db.execute(sql`
    UPDATE events 
    SET payload = payload || jsonb_build_object('progress', ${progress}::text)
    WHERE id = ${eventId}
  `);
}

async function processEventById(eventId: string): Promise<void> {
  const startTime = Date.now();
  
  // Fetch event details to check backoff and claims
  const selectRes = await db.execute(sql`
    SELECT * FROM events WHERE id = ${eventId} LIMIT 1
  `);
  
  if (selectRes.rows.length === 0) return;
  const eventRow = selectRes.rows[0] as any;

  // 1. Backoff Check
  if (eventRow.processing_status === 'retrying') {
    const ready = isEventReadyForRetry(new Date(eventRow.created_at), eventRow.retry_count || 0);
    if (!ready) {
      return; // Skip this execution window
    }
  }

  // 2. Atomic claim
  const claimRes = await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);

  if (claimRes.rows.length === 0) return; // Already claimed

  const userId = eventRow.user_id as string;
  const payload = eventRow.payload as any;

  console.log(`[Extractor] Processing event ${eventId} (Priority: ${eventRow.priority})`);

  try {
    await updateProgress(eventId, 'Extracting Context...');
    const recentMems = await db.execute(sql`
      SELECT content FROM nodes 
      WHERE node_type = 'memory' AND user_id = ${userId}
      ORDER BY created_at DESC LIMIT 10
    `);
    const recentText = recentMems.rows.map((r: any, i: number) => `${i + 1}. ${r.content}`).join('\n');

    const promptInstruction = `
      You are AION, extracting structured metadata from a new thought.
      Here are the user's recent thoughts for context:
      ${recentText || 'None'}

      Return a JSON object with exactly these fields:
      - summary: A concise summary of the thought.
      - project: A single string representing the broader project or category this thought belongs to. Keep it short.
      - subproject: A single string representing the subproject or specific topic. Set to null if none.
      - entities: An array of strings representing key specific entities.
      - people: An array of strings representing people mentioned by name.
      - contradictions: An array of strings representing entities or projects that this new thought actively contradicts or reverses.
      - action_items: An array of strings representing clear tasks or action items.
      - sentiment: One of "positive", "neutral", "negative", "anxious", "excited", "reflective".
      - mood_score: An integer from 1 to 10 (1=very negative, 5=neutral, 10=very positive).
      - requires_research: A boolean.
      - research_query: Search query if requires_research is true. null otherwise.
      - priority: One of "low", "normal", "important", "urgent", "critical".
      - cognitive_urgency: A float from 0.0 to 1.0.
      - planning_relevance: A float from 0.0 to 1.0.
      - requires_immediate_attention: A boolean.
      Do NOT include a transcription field. Output ONLY raw JSON.
    `;

    let aiResponse: string;
    let transcription: string | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const isMedia = (payload.type === 'audio' || payload.type === 'image') && payload.mediaBase64;
    
    if (isMedia) {
      const transcriptionPrompt = payload.type === 'audio'
        ? 'Provide an exact word-for-word transcription of the spoken words in this audio.'
        : 'Provide a detailed description of the text and visual elements in this image.';
        
      try {
        const transcriptResult = await llm.generateContentWithMetrics({
          prompt: transcriptionPrompt,
          mediaBuffer: payload.mediaBase64,
          mimeType: payload.mimeType,
          subsystem: 'extractor',
          priority: eventRow.priority,
        });
        transcription = transcriptResult.text.trim();
        totalPromptTokens += transcriptResult.usage?.promptTokens || 0;
        totalCompletionTokens += transcriptResult.usage?.completionTokens || 0;
      } catch (e: any) {
        console.warn('[Extractor] Media transcription failed:', e.message);
      }

      const metadataResult = await llm.generateContentWithMetrics({
        systemInstruction: payload.type === 'audio' ? 'Listen to this audio thought.' : 'Analyze this image thought.',
        prompt: promptInstruction,
        mediaBuffer: payload.mediaBase64,
        mimeType: payload.mimeType,
        subsystem: 'extractor',
        priority: eventRow.priority,
      });
      aiResponse = metadataResult.text;
      totalPromptTokens += metadataResult.usage?.promptTokens || 0;
      totalCompletionTokens += metadataResult.usage?.completionTokens || 0;
    } else {
      transcription = payload.content || null;
      const metadataResult = await llm.generateContentWithMetrics({
        prompt: `Analyze this thought: "${payload.content}"\n${promptInstruction}`,
        subsystem: 'extractor',
        priority: eventRow.priority,
      });
      aiResponse = metadataResult.text;
      totalPromptTokens += metadataResult.usage?.promptTokens || 0;
      totalCompletionTokens += metadataResult.usage?.completionTokens || 0;
    }

    const parsed = cleanAndParseJson(aiResponse);
    let finalSummary = parsed.summary;
    
    await updateProgress(eventId, 'Generating Neural Embeddings...');
    // Decoupled embedding service call
    let embeddingVector = await embeddingService.generateEmbedding(finalSummary);

    const priority = parsed.priority || 'normal';
    const cognitiveUrgency = Number(parsed.cognitive_urgency) || 0.0;
    const planningRelevance = Number(parsed.planning_relevance) || 0.0;
    const requiresImmediateAttention = !!parsed.requires_immediate_attention;

    const estimatedCost = (totalPromptTokens * 0.000075 + totalCompletionTokens * 0.0003) / 1000;
    const tokenUsage = totalPromptTokens + totalCompletionTokens;
    const cognitiveComplexity = (parsed.entities?.length || 0) * 0.2 + (parsed.contradictions?.length || 0) * 0.5 + (parsed.action_items?.length || 0) * 0.3;
    const processingWeight = requiresImmediateAttention ? 2.0 : 1.0;

    const initialRawContent = transcription || payload.content || '[Media Thought]';

    await updateProgress(eventId, 'Finding Related Memories...');
    // Cosine similarity search using cosine distance operator <=>
    const vectorString = `[${embeddingVector.join(",")}]`;
console.log("Embedding dimension:", embeddingVector.length);
    const similarNodes = await db.execute(sql`
      SELECT id, content, metadata,
            1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM nodes
      WHERE node_type = 'memory'
        AND user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT 3
    `);

    await updateProgress(eventId, 'Finalizing Memory Graph...');
    await db.transaction(async (tx) => {
      // Create raw thought node
      const [rawThoughtNode] = await tx.insert(nodes).values({
        userId,
        nodeType: 'raw_thought',
        content: payload.content || transcription || '[Media Thought]',
        metadata: { originalEventId: eventId, type: payload.type }
      }).returning();

      if (!rawThoughtNode) throw new Error('Failed to insert raw thought node');

      let memoryNodeId: string;
      const topMatch = similarNodes.rows[0] as any;
      
      if (topMatch && (topMatch.similarity as number) > 0.80) {
        memoryNodeId = topMatch.id as string;
        
        const mergePrompt = `
          Consolidate this new thought summary into an existing memory.
          Existing: "${topMatch.content}"
          New Details: "${parsed.summary}"
          Output only the combined comprehensive summary.
        `;

        const mergeResult = await llm.generateContentWithMetrics({
          prompt: mergePrompt,
          subsystem: 'extractor',
          priority,
        });
        
        finalSummary = mergeResult.text.trim();
        embeddingVector = await embeddingService.generateEmbedding(finalSummary);

        const existingMeta = { ...(topMatch.metadata as any || {}) };
        if (!existingMeta.rawContent) {
          existingMeta.rawContent = topMatch.content;
        }
        if (payload.mediaBase64) {
          existingMeta.mediaBase64 = payload.mediaBase64;
          existingMeta.mimeType = payload.mimeType;
          existingMeta.type = payload.type;
        }
        const vectorString = `[${embeddingVector.join(",")}]`;
        const metadataString = JSON.stringify(existingMeta);

        await tx.execute(sql`
          UPDATE nodes
          SET content = ${finalSummary},
              embedding = ${vectorString}::vector,
              metadata = ${metadataString}::jsonb,
              updated_at = NOW()
          WHERE id = ${memoryNodeId}
        `);
      } else {
        // Create new memory node
        const [memoryNode] = await tx.insert(nodes).values({
          userId,
          nodeType: 'memory',
          content: parsed.summary,
          embedding: embeddingVector,
          metadata: { 
            originalEventId: eventId, 
            sentiment: parsed.sentiment || 'neutral',
            moodScore: parsed.mood_score || 5,
            rawContent: initialRawContent,
            priority,
            cognitiveUrgency,
            planningRelevance,
            requiresImmediateAttention,
            mediaBase64: payload.mediaBase64,
            mimeType: payload.mimeType,
            type: payload.type
          }
        }).returning();

        if (!memoryNode) throw new Error('Failed to insert memory node');
        memoryNodeId = memoryNode.id;
      }

      // Link summaries relation
      await tx.insert(edges).values({
        sourceNodeId: memoryNodeId,
        targetNodeId: rawThoughtNode.id,
        relationType: 'summarizes',
      });

      // Link similar thoughts
      for (const simNode of similarNodes.rows) {
        if ((simNode.similarity as number) > 0.85 && simNode.id !== memoryNodeId) {
          await tx.insert(edges).values({
            sourceNodeId: rawThoughtNode.id,
            targetNodeId: simNode.id as string,
            relationType: 'similar_to',
            weight: simNode.similarity as number,
          });
        }
      }

      // Dynamic Node Resolver
      const resolveNode = async (nodeType: string, content: string) => {
        const existing = await tx.execute(sql`
          SELECT id FROM nodes 
          WHERE node_type = ${nodeType} AND lower(content) = lower(${content}) AND user_id = ${userId}
          LIMIT 1
        `);
        if (existing?.rows?.length > 0) return existing?.rows?.[0]?.id as string;
        
        const [newNode] = await tx.insert(nodes).values({ userId, nodeType, content }).returning();
        if (!newNode) throw new Error('Failed to insert node');
        return newNode.id;
      };

      const linkMemoryToProject = async (memId: string, projId: string) => {
        const existingEdge = await tx.execute(sql`
          SELECT id FROM edges WHERE source_node_id = ${memId} AND target_node_id = ${projId} AND relation_type = 'belongs_to' LIMIT 1
        `);
        if (existingEdge.rows.length === 0) {
          await tx.insert(edges).values({ sourceNodeId: memId, targetNodeId: projId, relationType: 'belongs_to' });
        }
      };

      // Project logic
      if (parsed.project) {
        const projectId = await resolveNode('project', parsed.project);
        await linkMemoryToProject(memoryNodeId, projectId);

        if (parsed.subproject) {
          const subprojectId = await resolveNode('project', parsed.subproject);
          
          const existingEdge = await tx.execute(sql`
            SELECT id FROM edges WHERE source_node_id = ${subprojectId} AND target_node_id = ${projectId} AND relation_type = 'subproject_of' LIMIT 1
          `);
          if (existingEdge.rows.length === 0) {
            await tx.insert(edges).values({ sourceNodeId: subprojectId, targetNodeId: projectId, relationType: 'subproject_of' });
          }
          await linkMemoryToProject(memoryNodeId, subprojectId);
        }
      }

      // Entities & People
      if (parsed.entities && Array.isArray(parsed.entities)) {
        for (const entity of parsed.entities) {
          const entityId = await resolveNode('entity', entity);
          await tx.insert(edges).values({ sourceNodeId: memoryNodeId, targetNodeId: entityId, relationType: 'mentions' });
        }
      }

      if (parsed.people && Array.isArray(parsed.people)) {
        for (const person of parsed.people) {
          const personId = await resolveNode('person', person);
          await tx.insert(edges).values({ sourceNodeId: memoryNodeId, targetNodeId: personId, relationType: 'mentions_person' });
        }
      }

      if (parsed.contradictions && Array.isArray(parsed.contradictions)) {
        for (const contradiction of parsed.contradictions) {
          const cId = await resolveNode('entity', contradiction);
          await tx.insert(edges).values({ sourceNodeId: memoryNodeId, targetNodeId: cId, relationType: 'contradicts' });
        }
      }

      // Action items
      if (parsed.action_items && Array.isArray(parsed.action_items)) {
        for (const action of parsed.action_items) {
          const [actionNode] = await tx.insert(nodes).values({ userId, nodeType: 'action_item', content: action }).returning();
          if (actionNode) {
            await tx.insert(edges).values({ sourceNodeId: memoryNodeId, targetNodeId: actionNode.id, relationType: 'relates_to' });
          }
        }
      }

      // Complete event and insert processing metadata
      await tx.execute(sql`
        UPDATE events SET 
          processing_status = 'completed',
          priority = ${priority},
          cognitive_urgency = ${cognitiveUrgency},
          planning_relevance = ${planningRelevance},
          requires_immediate_attention = ${requiresImmediateAttention},
          estimated_cost = ${estimatedCost},
          token_usage = ${tokenUsage},
          processing_weight = ${processingWeight},
          cognitive_complexity = ${cognitiveComplexity}
        WHERE id = ${eventId}
      `);

      await insertEvent(tx, {
        userId,
        eventType: 'memory_processed',
        payload: { originalEventId: eventId, summary: finalSummary }
      });
    });

    console.log(`[Extractor] Successfully processed event ${eventId}`);
    await incrementUsage(userId);

    // Trigger loop detection asynchronously in background
    LoopDetectionService.detectLoops(userId).catch(err => {
      console.error('[Extractor] Loop detection background task failed:', err);
    });

    // Enqueue research event
    if (parsed.requires_research && parsed.research_query) {
      await insertEvent(db, {
        userId,
        eventType: 'research_requested',
        payload: { query: parsed.research_query, sourceEventId: eventId, sourceSummary: parsed.summary },
        priority,
        cognitiveUrgency,
        planningRelevance,
        requiresImmediateAttention
      });
    }

    // Enqueue plan update event
    await insertEvent(db, {
      userId,
      eventType: 'plan_update_requested',
      payload: { reason: 'new_thought_processed', newInfo: parsed.summary, sourceEventId: eventId },
      priority,
      cognitiveUrgency,
      planningRelevance,
      requiresImmediateAttention
    });

    CognitionLogger.log({
      subsystem: 'extractor',
      action: 'extraction_completed',
      userId,
      inputs: { rawLength: payload.content?.length || 0 },
      outputs: { summary: finalSummary, priority, cost: estimatedCost },
      latencyMs: Date.now() - startTime,
      reason: `Successfully extracted structured entities, project belongs-to mappings, and research requirements for memory ${eventId}`,
    });

  } catch (e: any) {
    const currentRetry = ((eventRow.retry_count as number) || 0) + 1;
    const isDlq = currentRetry >= MAX_RETRIES;
    const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
    const errorMessage = e?.stack || e?.message || String(e);

    await db.execute(sql`
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);

    if (isDlq) {
      console.error(`[Extractor] Event ${eventId} moved to DLQ. Error: ${errorMessage}`);
    } else {
      console.warn(`[Extractor] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}
