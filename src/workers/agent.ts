import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { env } from '../config/env.js';
import * as cheerio from 'cheerio';
import { PgNotifyListener, type NotifyPayload } from '../services/pg_notify_listener.service.js';

const MAX_RETRIES = 5;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Start the Autonomous Research Agent Worker.
 * 
 * Uses PostgreSQL LISTEN/NOTIFY for instant event processing.
 * Falls back to a 90-second sweep for any events missed during reconnection windows.
 */
export const startAgentWorker = () => {
  console.log('[Agent] Starting Autonomous Research Agent (push-driven)...');

  // 1. Primary: LISTEN/NOTIFY push-based processing
  const listener = new PgNotifyListener('aion_research_queue', handleNotification);
  listener.start().catch(err => {
    console.error('[Agent] Failed to start LISTEN/NOTIFY listener:', err);
  });

  // 2. Fallback: Periodic sweep for missed events
  setInterval(async () => {
    try {
      await sweepPendingResearch();
    } catch (error) {
      console.error('[Agent] Sweep error:', error);
    }
  }, 90000);
};

async function handleNotification(payload: NotifyPayload): Promise<void> {
  try {
    await processResearchById(payload.id);
  } catch (error) {
    console.error(`[Agent] Notification handler error for event ${payload.id}:`, error);
  }
}

async function sweepPendingResearch(): Promise<void> {
  if (!llm.isConfigured) return;

  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'research_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'research_completed'
      AND e2.payload->>'sourceResearchId' = events.id::text
    )
    ORDER BY created_at ASC
    LIMIT 3
  `);

  if (pending.rows.length === 0) return;

  console.log(`[Agent] Sweep found ${pending.rows.length} pending research request(s).`);
  for (const row of pending.rows) {
    await processResearchById(row.id as string);
  }
}

async function processResearchById(eventId: string): Promise<void> {
  if (!llm.isConfigured) return;

  const result = await db.execute(sql`
    SELECT * FROM events
    WHERE id = ${eventId}
    AND event_type = 'research_requested'
    AND processing_status != 'completed'
    AND processing_status != 'failed'
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as any;
  if (!row) return;
  const userId = row.user_id as string;
  const payload = row.payload as any;
  const query = payload.query as string;

  // Atomic claim
  await db.execute(sql`
    UPDATE events SET processing_status = 'processing'
    WHERE id = ${eventId} AND processing_status IN ('pending', 'retrying')
  `);

  console.log(`[Agent] Researching: "${query}"`);

  try {
    // Step 1: Scrape DuckDuckGo HTML results
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!searchResponse.ok) {
      console.error(`[Agent] Search failed for "${query}": ${searchResponse.status}`);
      await markComplete(eventId, userId, query, 'Search request failed.');
      return;
    }

    const html = await searchResponse.text();
    const $ = cheerio.load(html);

    // Extract search result snippets
    const snippets: string[] = [];
    $('.result__snippet').each((_i, el) => {
      const text = $(el).text().trim();
      if (text) snippets.push(text);
    });
    
    // Also extract result titles for context
    const titles: string[] = [];
    $('.result__a').each((_i, el) => {
      const text = $(el).text().trim();
      if (text) titles.push(text);
    });

    if (snippets.length === 0) {
      console.log(`[Agent] No results found for "${query}"`);
      await markComplete(eventId, userId, query, 'No search results found for this topic.');
      return;
    }

    // Step 2: Build context and summarize with LLM
    const searchContext = snippets.slice(0, 6).map((s, i) => `[${i + 1}] ${titles[i] || ''}: ${s}`).join('\n');

    const prompt = `You are AION's research agent. The user had a thought: "${payload.sourceSummary}"
This triggered a research query: "${query}"

Here are web search results:
${searchContext}

Synthesize a concise, insightful research briefing (3-5 sentences) that:
1. Directly answers or enriches the user's original thought
2. Provides the most important facts or findings
3. Notes any surprising or counter-intuitive findings

Write as AION speaking to the user. Be specific and factual. Do not use markdown.`;

    const summary = await llm.generateContent({ prompt });

    // Step 3: Find original memory node and merge research findings
    let sourceMemoryNodeId: string | null = null;
    let originalMemoryContent = '';
    
    if (payload.sourceEventId) {
      const sourceMemory = await db.execute(sql`
        SELECT id, content FROM nodes 
        WHERE metadata->>'originalEventId' = ${payload.sourceEventId}
        AND node_type = 'memory'
        LIMIT 1
      `);
      if (sourceMemory.rows.length > 0) {
        sourceMemoryNodeId = sourceMemory.rows[0]?.id as string;
        originalMemoryContent = sourceMemory.rows[0]?.content as string;
      }
    }

    if (sourceMemoryNodeId) {
      // LLM merge and update existing memory node
      const mergePrompt = `
        You are AION, a cognitive operating system. Your task is to enrich an existing memory node with new web research findings to keep the memory graph consolidated, clean, and evolving without creating duplicate nodes.

        Existing Memory Content:
        "${originalMemoryContent}"

        New Research Findings:
        "${summary}"

        Please return a synthesized, consolidated, and comprehensive single memory summary that integrates these research findings into the existing memory naturally. Keep it cohesive and clear.
        Output ONLY the final merged content text. No conversational filler, no tags, no JSON, no markdown codeblocks. Just the plain text.
      `;
      const mergedContent = (await llm.generateContent({ prompt: mergePrompt })).trim();
      const newEmbedding = await llm.embedContent(mergedContent);

      await db.execute(sql`
        UPDATE nodes
        SET content = ${mergedContent},
            embedding = ${JSON.stringify(newEmbedding)}::vector,
            updated_at = NOW()
        WHERE id = ${sourceMemoryNodeId}
      `);
      console.log(`[Agent] Enriched and updated original memory node ${sourceMemoryNodeId} with research findings.`);
    } else {
      // Fallback: Create new memory node if the original was somehow deleted/not found
      console.warn(`[Agent] Original memory node not found for source event ${payload.sourceEventId}. Creating fallback research memory node.`);
      const embeddingVector = await llm.embedContent(summary);
      await db.insert(nodes).values({
        userId,
        nodeType: 'memory',
        content: `[Research] ${summary}`,
        embedding: embeddingVector,
        metadata: {
          type: 'autonomous_research',
          query,
          sourceEventId: payload.sourceEventId,
          sourceSummary: payload.sourceSummary,
          snippetCount: snippets.length,
        },
      });
    }

    await markComplete(eventId, userId, query, summary);
    console.log(`[Agent] Research completed for "${query}"`);
    
    await delay(3000); // Rate limiting
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
      console.error(`[Agent] Event ${eventId} moved to DLQ after ${MAX_RETRIES} failures. Last error: ${errorMessage}`);
    } else {
      console.warn(`[Agent] Event ${eventId} failed (attempt ${currentRetry}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}

async function markComplete(eventId: string, userId: string, query: string, summary: string) {
  // Mark the source event as completed
  await db.execute(sql`
    UPDATE events SET processing_status = 'completed'
    WHERE id = ${eventId}
  `);

  await db.insert(events).values({
    userId,
    eventType: 'research_completed',
    payload: { sourceResearchId: eventId, query, summary },
  });

  // Trigger the planner to re-evaluate today's plan with research findings
  if (summary && !summary.startsWith('Research failed')) {
    await db.insert(events).values({
      userId,
      eventType: 'plan_update_requested',
      payload: { reason: 'research_completed', newInfo: `Research on "${query}": ${summary}`, sourceEventId: eventId }
    });
  }
}
