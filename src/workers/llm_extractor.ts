import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { env } from '../config/env.js';
import { incrementUsage } from '../core/middlewares/quota.middleware.js';
import { PgNotifyListener, type NotifyPayload } from '../services/pg_notify_listener.service.js';
import { cleanAndParseJson } from '../core/utils.js';

const MAX_RETRIES = 5;

/**
 * Start the LLM Extractor Worker.
 * 
 * Uses PostgreSQL LISTEN/NOTIFY for instant event processing.
 * Falls back to a 60-second sweep for any events missed during reconnection windows.
 */
export const startWorker = () => {
  console.log('[Extractor] Starting AI Processing Worker (push-driven)...');

  // 1. Primary: LISTEN/NOTIFY push-based processing
  const listener = new PgNotifyListener('aion_memory_queue', handleNotification);
  listener.start().catch(err => {
    console.error('[Extractor] Failed to start LISTEN/NOTIFY listener:', err);
  });

  // 2. Fallback: Periodic sweep for missed events (reconnection gaps, DLQ retries)
  setInterval(async () => {
    try {
      await sweepPendingEvents();
    } catch (error) {
      console.error('[Extractor] Sweep error:', error);
    }
  }, 60000); // Every 60 seconds (reduced from 15s since push handles the hot path)
};

/**
 * Handle a NOTIFY push event: look up the full event and process it.
 */
async function handleNotification(payload: NotifyPayload): Promise<void> {
  try {
    await processEventById(payload.id);
  } catch (error) {
    console.error(`[Extractor] Notification handler error for event ${payload.id}:`, error);
  }
}

/**
 * Fallback sweep: finds pending events that weren't processed via NOTIFY
 * (e.g., during listener reconnection, server restart, or retryable failures).
 */
async function sweepPendingEvents(): Promise<void> {
  if (!llm.isConfigured) return;

  const pendingEvents = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'memory_created'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'memory_processed'
      AND e2.payload->>'originalEventId' = events.id::text
    )
    ORDER BY created_at ASC
    LIMIT 5
  `);

  if (pendingEvents.rows.length === 0) return;

  console.log(`[Extractor] Sweep found ${pendingEvents.rows.length} pending event(s).`);
  for (const row of pendingEvents.rows) {
    await processEventById(row.id as string);
  }
}

/**
 * Core processing logic with DLQ fault isolation.
 * 
 * On failure:
 *   - Increments retry_count
 *   - Stores the error trace in last_error
 *   - After MAX_RETRIES, marks as 'failed' (DLQ) to prevent infinite loops
 */
async function processEventById(eventId: string): Promise<void> {
  if (!llm.isConfigured) {
    console.error('[Extractor] LLM service is not configured. Skipping.');
    return;
  }

  // Fetch the full event
  const result = await db.execute(sql`
    SELECT * FROM events
    WHERE id = ${eventId}
    AND event_type = 'memory_created'
    AND processing_status != 'completed'
    AND processing_status != 'failed'
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as any;
  if (!row) return;
  const userId = row.user_id as string;
  const payload = row.payload as any;

  // Mark as processing (atomic claim)
  await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
  `);

  console.log(`[Extractor] Processing event ${eventId}...`);

  try {
    const recentMems = await db.execute(sql`
      SELECT content FROM nodes 
      WHERE node_type = 'memory' AND user_id = ${userId}
      ORDER BY created_at DESC LIMIT 10
    `);
    const recentText = recentMems.rows.map((r: any, i: number) => `${i + 1}. ${r.content}`).join('\n');

    // NOTE: 'transcription' is deliberately NOT in the JSON schema.
    // Asking the LLM to echo raw content (web pages, articles, audio) inside JSON
    // causes chronic parse failures due to unescaped quotes/special chars.
    // Instead, we capture transcription separately as plain text.
    const promptInstruction = `
      You are AION, extracting structured metadata from a new thought.
      Here are the user's recent thoughts for context:
      ${recentText || 'None'}

      Return a JSON object with exactly these fields:
      - summary: A concise summary of the thought.
      - project: A single string representing the broader project or category this thought belongs to (e.g., "Learning", "Work", "Personal"). Keep it short and high-level.
      - subproject: A single string representing the subproject or specific topic within the project (e.g., "Flutter", "Tax Filing", "Cooking"). If no subproject applies, set to null.
      - entities: An array of strings representing key specific entities.
      - people: An array of strings representing people mentioned by name.
      - contradictions: An array of strings representing entities or projects that this new thought actively contradicts or reverses based on the context. Empty array if none.
      - action_items: An array of strings representing clear tasks or action items derived from the thought. Empty array if none.
      - sentiment: One of "positive", "neutral", "negative", "anxious", "excited", "reflective".
      - mood_score: An integer from 1 to 10 (1=very negative, 5=neutral, 10=very positive).
      - requires_research: A boolean. true if this thought mentions a topic, concept, or question that could benefit from web research to provide more context or answer the user's curiosity. false otherwise.
      - research_query: If requires_research is true, a short web search query string (max 10 words) to find relevant information. null if false.
      - priority: One of "low", "normal", "important", "urgent", "critical". "urgent" or "critical" should be reserved for strict deadlines, severe emotional stress, goal conflicts, or direct high-priority planning/task requests.
      - cognitive_urgency: A float from 0.0 to 1.0 indicating how immediately this thought impacts the user's current goals or mental state (e.g. high urgency if they mention an active crisis, deadline, or immediate emotional shift).
      - planning_relevance: A float from 0.0 to 1.0 indicating how strongly this thought affects the user's daily plan or schedule (e.g. high relevance for schedule blocks, appointments, new high-level goals).
      - requires_immediate_attention: A boolean. true if the priority is "urgent" or "critical", or if cognitive_urgency > 0.8, or if the user explicitly demands immediate action. false otherwise.
      Do NOT include a transcription field. Output ONLY raw JSON without markdown formatting.
    `;

    let aiResponse: string;
    let transcription: string | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    if ((payload.type === 'audio' || payload.type === 'image') && payload.mediaBase64) {
      // Step 1: Get transcription as plain text (separate call — no JSON formatting risks)
      const transcriptionPrompt = payload.type === 'audio'
        ? 'Provide an exact word-for-word transcription of the spoken words in this audio. Output ONLY the transcription text, nothing else.'
        : 'Provide a detailed description of the text and visual elements in this image. Output ONLY the description text, nothing else.';
      try {
        const transcriptResult = await llm.generateContentWithMetrics({
          prompt: transcriptionPrompt,
          mediaBuffer: payload.mediaBase64,
          mimeType: payload.mimeType,
        });
        transcription = transcriptResult.text.trim();
        totalPromptTokens += transcriptResult.usage?.promptTokens || 0;
        totalCompletionTokens += transcriptResult.usage?.completionTokens || 0;
      } catch (e) {
        console.warn('[Extractor] Transcription extraction failed, continuing without:', (e as Error).message);
      }

      // Step 2: Get structured metadata (JSON) — transcription is NOT part of this output
      const metadataResult = await llm.generateContentWithMetrics({
        systemInstruction: payload.type === 'audio' ? 'Listen to this audio thought.' : 'Analyze this image thought.',
        prompt: promptInstruction,
        mediaBuffer: payload.mediaBase64,
        mimeType: payload.mimeType,
      });
      aiResponse = metadataResult.text;
      totalPromptTokens += metadataResult.usage?.promptTokens || 0;
      totalCompletionTokens += metadataResult.usage?.completionTokens || 0;
    } else {
      // For text inputs, the raw content IS the transcription — no LLM call needed
      transcription = payload.content || null;
      const metadataResult = await llm.generateContentWithMetrics({
        prompt: `Analyze this thought: "${payload.content}"\n${promptInstruction}`
      });
      aiResponse = metadataResult.text;
      totalPromptTokens += metadataResult.usage?.promptTokens || 0;
      totalCompletionTokens += metadataResult.usage?.completionTokens || 0;
    }
    
    const parsed = cleanAndParseJson(aiResponse);
    let finalSummary = parsed.summary;
    let embeddingVector = await llm.embedContent(finalSummary);

    // Prioritization and cost variables
    const priority = parsed.priority || 'normal';
    const cognitiveUrgency = Number(parsed.cognitive_urgency) || 0.0;
    const planningRelevance = Number(parsed.planning_relevance) || 0.0;
    const requiresImmediateAttention = !!parsed.requires_immediate_attention;

    const estimatedCost = (totalPromptTokens * 0.000075 + totalCompletionTokens * 0.0003) / 1000;
    const tokenUsage = totalPromptTokens + totalCompletionTokens;
    const cognitiveComplexity = (parsed.entities?.length || 0) * 0.2 + (parsed.contradictions?.length || 0) * 0.5 + (parsed.action_items?.length || 0) * 0.3;
    const processingWeight = requiresImmediateAttention ? 2.0 : 1.0;

    const initialRawContent = transcription || payload.content || (payload.type === 'audio' ? '[Audio Thought]' : payload.type === 'image' ? '[Image Thought]' : '[Media Thought]');

    // Perform Similarity Search to find related past memories (including metadata)
    const similarNodes = await db.execute(sql`
      SELECT id, content, metadata, 1 - (embedding <=> ${sql.raw(JSON.stringify(embeddingVector))}::vector) as similarity
      FROM nodes
      WHERE node_type = 'memory' AND user_id = ${userId}
      ORDER BY embedding <=> ${sql.raw(JSON.stringify(embeddingVector))}::vector
      LIMIT 3
    `);

    await db.transaction(async (tx) => {
      // 1. Create the Raw Thought Anchor
      const [rawThoughtNode] = await tx.insert(nodes).values({
        userId,
        nodeType: 'raw_thought',
        content: payload.content || parsed.transcription || '[Media Thought]',
        metadata: { originalEventId: eventId, type: payload.type }
      }).returning();

      if (!rawThoughtNode) throw new Error('Failed to insert raw thought node');

      // Check for similarity merging (> 0.80)
      let memoryNodeId: string;
      const topMatch = similarNodes.rows[0] as any;
      if (topMatch && (topMatch.similarity as number) > 0.80) {
        memoryNodeId = topMatch.id as string;
        console.log(`[Extractor] High similarity match found (${(topMatch.similarity as number).toFixed(2)} > 0.80). Merging with memory node ${memoryNodeId}...`);

        const mergePrompt = `
          You are AION, a cognitive operating system. Your task is to merge a new thought summary into an existing memory node's content to keep the memory graph consolidated, clean, and evolving without creating duplicate nodes.

          Existing Memory Content:
          "${topMatch.content}"

          New Thought Summary:
          "${parsed.summary}"

          Please return an enriched, consolidated, and comprehensive single summary that captures both the existing memory and the new details naturally, without repeating information. Keep it cohesive and clear.
          Output ONLY the final merged content text. No conversational filler, no tags, no JSON, no markdown codeblocks. Just the plain text.
        `;

        const mergeResult = await llm.generateContentWithMetrics({ prompt: mergePrompt });
        const mergedContent = mergeResult.text.trim();
        finalSummary = mergedContent;
        // Generate new embedding for the merged content
        embeddingVector = await llm.embedContent(mergedContent);

        // Preserve and back-populate the original initial thought in metadata
        const existingMeta = { ...(topMatch.metadata as any || {}) };
        if (!existingMeta.rawContent) {
          existingMeta.rawContent = topMatch.content;
        }

        // Update existing memory node
        await tx.execute(sql`
          UPDATE nodes
          SET content = ${mergedContent},
              embedding = ${sql.raw(JSON.stringify(embeddingVector))}::vector,
              metadata = ${sql.raw(JSON.stringify(existingMeta))}::jsonb,
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
            requiresImmediateAttention
          }
        }).returning();

        if (!memoryNode) throw new Error('Failed to insert primary memory node');
        memoryNodeId = memoryNode.id;
      }

      // Link memory to raw thought
      await tx.insert(edges).values({
        sourceNodeId: memoryNodeId,
        targetNodeId: rawThoughtNode.id,
        relationType: 'summarizes',
      });

      // 3. Link similar past thoughts (excluding the merged node if we merged)
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

      const resolveNode = async (nodeType: string, content: string) => {
        const existing = await tx.execute(sql`
          SELECT id FROM nodes 
          WHERE node_type = ${nodeType} AND lower(content) = lower(${content}) AND user_id = ${userId}
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

      const linkMemoryToProject = async (memId: string, projId: string) => {
        const existingBelongsTo = await tx.execute(sql`
          SELECT id FROM edges
          WHERE source_node_id = ${memId}
          AND target_node_id = ${projId}
          AND relation_type = 'belongs_to'
          LIMIT 1
        `);
        if (existingBelongsTo.rows.length === 0) {
          await tx.insert(edges).values({
            sourceNodeId: memId,
            targetNodeId: projId,
            relationType: 'belongs_to',
          });
        }
      };

      // Project/Subproject Resolution
      if (parsed.project) {
        const projectId = await resolveNode('project', parsed.project);
        
        // Link memory to the main project
        await linkMemoryToProject(memoryNodeId, projectId);

        if (parsed.subproject) {
          const subprojectId = await resolveNode('project', parsed.subproject);

          // Link subproject to parent project
          const existingEdge = await tx.execute(sql`
            SELECT id FROM edges
            WHERE source_node_id = ${subprojectId}
            AND target_node_id = ${projectId}
            AND relation_type = 'subproject_of'
            LIMIT 1
          `);
          if (existingEdge.rows.length === 0) {
            await tx.insert(edges).values({
              sourceNodeId: subprojectId,
              targetNodeId: projectId,
              relationType: 'subproject_of',
            });
          }

          // Link memory to the subproject too!
          await linkMemoryToProject(memoryNodeId, subprojectId);
        }
      }

      if (parsed.entities && Array.isArray(parsed.entities)) {
        for (const entity of parsed.entities) {
          const entityId = await resolveNode('entity', entity);
          await tx.insert(edges).values({
            sourceNodeId: memoryNodeId,
            targetNodeId: entityId,
            relationType: 'mentions',
          });
        }
      }

      if (parsed.people && Array.isArray(parsed.people)) {
        for (const person of parsed.people) {
          const personId = await resolveNode('person', person);
          await tx.insert(edges).values({
            sourceNodeId: memoryNodeId,
            targetNodeId: personId,
            relationType: 'mentions_person',
          });
        }
      }

      if (parsed.contradictions && Array.isArray(parsed.contradictions)) {
        for (const contradiction of parsed.contradictions) {
          const cId = await resolveNode('entity', contradiction);
          await tx.insert(edges).values({
            sourceNodeId: memoryNodeId,
            targetNodeId: cId,
            relationType: 'contradicts',
          });
        }
      }

      // Handle extracted action items
      if (parsed.action_items && Array.isArray(parsed.action_items)) {
        for (const action of parsed.action_items) {
          const [actionNode] = await tx.insert(nodes).values({
            userId,
            nodeType: 'action_item',
            content: action,
          }).returning();
          
          if (actionNode) {
            await tx.insert(edges).values({
              sourceNodeId: memoryNodeId,
              targetNodeId: actionNode.id,
              relationType: 'relates_to',
            });
          }
        }
      }

      // Mark the event as completed within the transaction
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

      await tx.insert(events).values({
        userId,
        eventType: 'memory_processed',
        payload: { originalEventId: eventId, summary: finalSummary }
      });
    });
    
    console.log(`[Extractor] Successfully processed event ${eventId}`);
    await incrementUsage(userId);

    // If research is needed, emit a research_requested event for the agent worker
    if (parsed.requires_research && parsed.research_query) {
      await db.insert(events).values({
        userId,
        eventType: 'research_requested',
        payload: { query: parsed.research_query, sourceEventId: eventId, sourceSummary: parsed.summary },
        priority,
        cognitiveUrgency,
        planningRelevance,
        requiresImmediateAttention
      });
      console.log(`[Extractor] Research requested: "${parsed.research_query}"`);
    }

    // Trigger the planner to re-evaluate today's plan with this new thought
    await db.insert(events).values({
      userId,
      eventType: 'plan_update_requested',
      payload: { reason: 'new_thought_processed', newInfo: parsed.summary, sourceEventId: eventId },
      priority,
      cognitiveUrgency,
      planningRelevance,
      requiresImmediateAttention
    });

  } catch (e: any) {
    // DLQ: increment retry count, store error trace
    const currentRetry = ((row.retry_count as number) || 0) + 1;
    const newStatus = currentRetry >= MAX_RETRIES ? 'failed' : 'retrying';
    const errorMessage = e?.message || String(e);

    await db.execute(sql`
      UPDATE events
      SET processing_status = ${newStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);

    if (newStatus === 'failed') {
      console.error(`[Extractor] Event ${eventId} moved to DLQ after ${MAX_RETRIES} failures. Last error: ${errorMessage}`);
    } else {
      console.warn(`[Extractor] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}
