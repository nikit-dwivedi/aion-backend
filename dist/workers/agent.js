import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { queueProvider } from '../core/queue.js';
import { SerperProvider } from '../features/research/serper.provider.js';
import { cleanAndParseJson } from '../core/utils.js';
import { embeddingService } from '../services/embedding.service.js';
import { CognitionLogger } from '../core/observability.js';
import { insertEvent } from '../core/events.js';
import { isEventReadyForRetry } from './llm_extractor.js';
const MAX_RETRIES = 5;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const startAgentWorker = () => {
    console.log('[Agent] Starting Autonomous Research Agent (push-driven)...');
    // Subscribe to research queue
    queueProvider.subscribe('research_queue', async (msg) => {
        if (msg.eventType === 'research_requested') {
            try {
                await processResearchById(msg.id);
            }
            catch (error) {
                console.error(`[Agent] Notification handler error for event ${msg.id}:`, error);
            }
        }
    });
    // Fallback periodic sweep
    setInterval(async () => {
        try {
            await sweepPendingResearch();
        }
        catch (error) {
            console.error('[Agent] Sweep error:', error);
        }
    }, 90000);
};
async function sweepPendingResearch() {
    const pending = await db.execute(sql `
    SELECT id FROM events
    WHERE event_type = 'research_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY CASE WHEN priority = 'critical' THEN 5 WHEN priority = 'urgent' THEN 4 WHEN priority = 'high' THEN 4 WHEN priority = 'important' THEN 4 WHEN priority = 'normal' THEN 3 WHEN priority = 'background' THEN 2 ELSE 1 END DESC, created_at ASC
    LIMIT 3
  `);
    for (const row of pending.rows) {
        await processResearchById(row.id);
    }
}
async function processResearchById(eventId) {
    const selectRes = await db.execute(sql `
    SELECT * FROM events WHERE id = ${eventId} LIMIT 1
  `);
    if (selectRes.rows.length === 0)
        return;
    const eventRow = selectRes.rows[0];
    // 1. Backoff Check
    if (eventRow.processing_status === 'retrying') {
        if (!isEventReadyForRetry(new Date(eventRow.created_at), eventRow.retry_count || 0)) {
            return;
        }
    }
    // 2. Claim Atomically
    const claimRes = await db.execute(sql `
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);
    if (claimRes.rows.length === 0)
        return; // Already claimed
    const userId = eventRow.user_id;
    const payload = eventRow.payload;
    const query = payload.query;
    const startTime = Date.now();
    console.log(`[Agent] Researching: "${query}" (Priority: ${eventRow.priority})`);
    try {
        const searchProvider = new SerperProvider();
        const searchResults = await searchProvider.search(query);
        if (searchResults.length === 0) {
            await markComplete(eventId, userId, query, 'No search results found for this topic.', eventRow.priority);
            return;
        }
        const searchContext = searchResults.slice(0, 6).map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet} (Source: ${s.url})`).join('\n');
        const prompt = `You are AION's research agent. The user had a thought: "${payload.sourceSummary}"
This triggered a research query: "${query}"

Here are web search results:
${searchContext}

Synthesize a concise, insightful research briefing (3-5 sentences) that:
1. Directly answers or enriches the user's original thought
2. Provides the most important facts or findings
3. Notes any surprising or counter-intuitive findings

Write as AION speaking to the user. Be specific and factual. Do not use markdown.`;
        const summary = await llm.generateContent({
            prompt,
            subsystem: 'research',
            priority: eventRow.priority,
        });
        let sourceMemoryNodeId = null;
        if (payload.sourceEventId) {
            const sourceMemory = await db.execute(sql `
        SELECT id FROM nodes 
        WHERE metadata->>'originalEventId' = ${payload.sourceEventId}
        AND node_type = 'memory'
        LIMIT 1
      `);
            if (sourceMemory.rows.length > 0) {
                sourceMemoryNodeId = sourceMemory.rows[0]?.id;
            }
        }
        const classifyPrompt = `
      Analyze relationship between:
      Thought: "${payload.sourceSummary}"
      Research Briefing: "${summary}"
      Classify: "enriches" | "supports" | "contradicts" | "expands".
      Return JSON:
      { "relationType": "...", "confidenceScore": 0.95, "confidenceSource": "...", "verificationState": "verified"/"unverified" }
    `;
        const classificationResponse = await llm.generateContent({
            prompt: classifyPrompt,
            subsystem: 'research',
            priority: eventRow.priority,
        });
        const parsedClassification = cleanAndParseJson(classificationResponse);
        const relationType = parsedClassification.relationType || 'enriches';
        const confidenceScore = Number(parsedClassification.confidenceScore) || 0.8;
        const confidenceSource = parsedClassification.confidenceSource || 'General semantic matching';
        const verificationState = parsedClassification.verificationState || 'unverified';
        // Decoupled embedding service call
        const researchEmbedding = await embeddingService.generateEmbedding(summary);
        await db.transaction(async (tx) => {
            // Create distinct research node
            const [researchNode] = await tx.insert(nodes).values({
                userId,
                nodeType: 'research',
                content: summary,
                embedding: researchEmbedding,
                metadata: {
                    query,
                    sourceEventId: payload.sourceEventId,
                    sourceSummary: payload.sourceSummary,
                    confidenceScore,
                    confidenceSource,
                    verificationState,
                    sources: searchResults.slice(0, 3)
                }
            }).returning();
            if (!researchNode)
                throw new Error('Failed to create research node');
            if (sourceMemoryNodeId) {
                await tx.insert(edges).values({
                    sourceNodeId: researchNode.id,
                    targetNodeId: sourceMemoryNodeId,
                    relationType,
                    weight: confidenceScore
                });
            }
        });
        await markComplete(eventId, userId, query, summary, eventRow.priority);
        CognitionLogger.log({
            subsystem: 'research',
            action: 'research_completed',
            userId,
            inputs: { query },
            outputs: { relationType, confidenceScore },
            latencyMs: Date.now() - startTime,
            reason: `Completed Serper search and linked child research node to memory ${sourceMemoryNodeId || 'none'}`,
        });
        await delay(3000);
    }
    catch (e) {
        const currentRetry = (eventRow.retry_count || 0) + 1;
        const isDlq = currentRetry >= MAX_RETRIES;
        const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
        const errorMessage = e?.stack || e?.message || String(e);
        await db.execute(sql `
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${currentRetry},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);
        if (isDlq) {
            console.error(`[Agent] Research event ${eventId} moved to DLQ. Error: ${errorMessage}`);
        }
        else {
            console.warn(`[Agent] Research event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
        }
    }
}
async function markComplete(eventId, userId, query, summary, priority) {
    await db.execute(sql `
    UPDATE events SET processing_status = 'completed'
    WHERE id = ${eventId}
  `);
    await insertEvent(db, {
        userId,
        eventType: 'research_completed',
        payload: { sourceResearchId: eventId, query, summary },
    });
    if (summary && !summary.startsWith('Research failed')) {
        await insertEvent(db, {
            userId,
            eventType: 'plan_update_requested',
            payload: { reason: 'research_completed', newInfo: `Research on "${query}": ${summary}`, sourceEventId: eventId },
            priority: priority,
        });
    }
}
//# sourceMappingURL=agent.js.map