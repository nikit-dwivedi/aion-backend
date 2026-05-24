import { db } from '../db/index.js';
import { events, nodes, edges } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { env } from '../config/env.js';
import * as cheerio from 'cheerio';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const startAgentWorker = () => {
  console.log('Starting Autonomous Research Agent...');
  
  setInterval(async () => {
    try {
      await processResearchRequests();
    } catch (error) {
      console.error('Agent worker error:', error);
    }
  }, 30000); // Check every 30 seconds
};

async function processResearchRequests() {
  if (!llm.isConfigured) return;

  const pending = await db.execute(sql`
    SELECT e1.* FROM events e1
    WHERE e1.event_type = 'research_requested'
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'research_completed'
      AND e2.payload->>'sourceResearchId' = e1.id::text
    )
    LIMIT 1
  `);

  if (pending.rows.length === 0) return;

  for (const row of pending.rows) {
    const eventId = row.id as string;
    const userId = row.user_id as string;
    const payload = row.payload as any;
    const query = payload.query as string;

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
        continue;
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
        continue;
      }

      // Step 2: Build context and summarize with Gemini
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

      // Step 3: Insert as a research memory node
      const embeddingVector = await llm.embedContent(summary);

      const [researchNode] = await db.insert(nodes).values({
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
      }).returning();

      // Step 4: Link to the source memory if it exists
      if (payload.sourceEventId) {
        const sourceMemory = await db.execute(sql`
          SELECT id FROM nodes 
          WHERE metadata->>'originalEventId' = ${payload.sourceEventId}
          LIMIT 1
        `);

        if (sourceMemory.rows.length > 0 && researchNode) {
          await db.insert(edges).values({
            sourceNodeId: researchNode.id,
            targetNodeId: sourceMemory.rows[0]?.id as string,
            relationType: 'enriches',
          });
        }
      }

      await markComplete(eventId, userId, query, summary);
      console.log(`[Agent] Research completed for "${query}"`);
      
      await delay(3000); // Rate limiting
    } catch (e) {
      console.error(`[Agent] Failed research for "${query}":`, e);
      await markComplete(eventId, userId, query, 'Research failed due to an error.');
    }
  }
}

async function markComplete(eventId: string, userId: string, query: string, summary: string) {
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
