import { db } from '../db/index.js';
import { nodes, edges } from '../db/schema.js';
import { sql, eq, inArray } from 'drizzle-orm';
import { queueProvider } from '../core/queue.js';
import { withAdvisoryLock, LOCK_EPISODIC_CLUSTERING } from '../core/locks.js';
import { llm } from '../services/llm.service.js';
import { cleanAndParseJson } from '../core/utils.js';
import { CognitionLogger } from '../core/observability.js';

const MAX_RETRIES = 5;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const startEpisodeWorker = () => {
  console.log('[EpisodeWorker] Starting Episodic Clustering Worker...');

  // Subscribe to background queue
  queueProvider.subscribe('background_evolution_queue', async (msg) => {
    if (msg.eventType === 'episodic_clustering_requested') {
      try {
        await processEpisodeEvent(msg.id);
      } catch (err) {
        console.error(`[EpisodeWorker] Event handler error for event ${msg.id}:`, err);
      }
    }
  });

  // Sweep fallback
  setInterval(async () => {
    try {
      await sweepPendingEpisodes();
    } catch (err) {
      console.error('[EpisodeWorker] Sweep error:', err);
    }
  }, 120000);
};

async function sweepPendingEpisodes(): Promise<void> {
  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'episodic_clustering_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 3
  `);

  for (const row of pending.rows) {
    await processEpisodeEvent(row.id as string);
  }
}

function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < v1.length; i++) {
    const val1 = v1[i] || 0;
    const val2 = v2[i] || 0;
    dotProduct += val1 * val2;
    normA += val1 * val1;
    normB += val2 * val2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function processEpisodeEvent(eventId: string): Promise<void> {
  const claimRes = await db.execute(sql`
    UPDATE events
    SET processing_status = 'processing'
    WHERE id = ${eventId}
    AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);

  if (claimRes.rows.length === 0) return;

  const eventRow = claimRes.rows[0] as any;
  const userId = eventRow.user_id as string;
  const startTime = Date.now();

  try {
    const lockAcquired = await withAdvisoryLock(LOCK_EPISODIC_CLUSTERING, async (tx) => {
      // 1. Fetch unclustered memory nodes for user in the last 48 hours
      const unclustered = await tx.execute(sql`
        SELECT id, content, embedding, created_at, metadata
        FROM nodes
        WHERE user_id = ${userId}
        AND node_type = 'memory'
        AND created_at > NOW() - INTERVAL '48 hours'
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          JOIN nodes n2 ON e.source_node_id = n2.id
          WHERE n2.node_type = 'episode'
          AND e.target_node_id = nodes.id
        )
        ORDER BY created_at ASC
      `);

      if (unclustered.rows.length < 3) {
        // Not enough unclustered memories to form a cohesive cluster (min size 3)
        await tx.execute(sql`
          UPDATE events
          SET processing_status = 'completed'
          WHERE id = ${eventId}
        `);
        return true;
      }

      // Convert rows to typed list
      const memories = unclustered.rows.map((r: any) => ({
        id: r.id as string,
        content: r.content as string,
        embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
        createdAt: new Date(r.created_at),
        metadata: r.metadata as any
      }));

      // 2. Perform deterministic proximity clustering
      const clusters: typeof memories[] = [];
      let currentCluster: typeof memories = [];

      for (let i = 0; i < memories.length; i++) {
        const mem = memories[i]!;
        if (currentCluster.length === 0) {
          currentCluster.push(mem);
          continue;
        }

        const lastMem = currentCluster[currentCluster.length - 1]!;
        const hoursDiff = Math.abs(mem.createdAt.getTime() - lastMem.createdAt.getTime()) / (1000 * 60 * 60);
        
        let sim = 0;
        if (mem.embedding && lastMem.embedding) {
          sim = cosineSimilarity(mem.embedding, lastMem.embedding);
        }

        const entityOverlap = mem.metadata?.entities && lastMem.metadata?.entities
          ? mem.metadata.entities.filter((e: string) => lastMem.metadata.entities.includes(e)).length
          : 0;

        // Grouping heuristics: created within 6 hours OR embedding similarity > 0.70 OR share entities
        if (hoursDiff <= 6 || sim > 0.70 || entityOverlap > 0) {
          currentCluster.push(mem);
        } else {
          if (currentCluster.length >= 3) {
            clusters.push(currentCluster);
          }
          currentCluster = [mem];
        }
      }
      if (currentCluster.length >= 3) {
        clusters.push(currentCluster);
      }

      let episodesFormed = 0;

      // 3. Enrich candidate clusters with LLM
      for (const cluster of clusters) {
        const matchingIds = cluster.map((m: any) => m.id);

        // Idempotency: Double check that none of these matchingIds are already linked to an episode node
        const preCheck = await tx.execute(sql`
          SELECT target_node_id FROM edges e
          JOIN nodes n ON e.source_node_id = n.id
          WHERE n.node_type = 'episode'
          AND e.target_node_id IN (${sql.raw(matchingIds.map((id: string) => `'${id}'`).join(','))})
          LIMIT 1
        `);

        if (preCheck.rows.length > 0) {
          continue; // Part of this cluster is already grouped
        }

        const listText = cluster.map((m: any, idx: number) => `[ID: ${m.id}] Thought ${idx + 1}: ${m.content} (${m.createdAt.toLocaleTimeString()})`).join('\n');

        const prompt = `
          You are AION's episodic memory consolidator.
          The following thoughts have been grouped together deterministically by time, topic, and entity signals:
          ${listText}

          Synthesize a short, cohesive description (1-2 sentences) summarizing this episode.
          Produce a short, meaningful title (max 5 words).

          Return a JSON object:
          {
            "title": "Meaningful name for the episode",
            "description": "Short summary description",
            "confidence": 0.95
          }
          Output ONLY raw JSON. No markdown.
        `;

        try {
          const response = await llm.generateContent({
            prompt,
            subsystem: 'clustering',
            priority: 'low'
          });

          const parsed = cleanAndParseJson(response);
          const confidence = parsed.confidence || 0.85;

          // Insert episode node
          const [episodeNode] = await tx.insert(nodes).values({
            userId,
            nodeType: 'episode',
            content: parsed.description,
            metadata: {
              title: parsed.title,
              confidenceScore: confidence,
              verificationState: 'verified',
              originalEventId: eventId
            }
          }).returning();

          if (episodeNode) {
            // Link matching memories to the episode
            for (const mid of matchingIds) {
              await tx.insert(edges).values({
                sourceNodeId: episodeNode.id,
                targetNodeId: mid,
                relationType: 'part_of_episode',
                weight: confidence
              });
            }
            episodesFormed++;
          }
        } catch (err: any) {
          console.error(`[EpisodeWorker] Failed to create episode node:`, err.message);
        }

        await delay(1000);
      }

      // Complete event
      await tx.execute(sql`
        UPDATE events
        SET processing_status = 'completed'
        WHERE id = ${eventId}
      `);

      CognitionLogger.log({
        subsystem: 'clustering',
        action: 'clustering_completed',
        userId,
        outputs: { episodesFormed },
        latencyMs: Date.now() - startTime,
        reason: `Evaluated unclustered memory nodes for user ${userId} and synthesized ${episodesFormed} episode(s).`,
      });
      return true;
    });

    if (!lockAcquired) {
      await db.execute(sql`
        UPDATE events
        SET processing_status = 'retrying'
        WHERE id = ${eventId}
      `);
    }
  } catch (err: any) {
    const retryCount = (eventRow.retry_count || 0) + 1;
    const isDlq = retryCount >= MAX_RETRIES;
    const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
    const errorMessage = err?.stack || err?.message || String(err);

    await db.execute(sql`
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${retryCount},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);

    console.error(`[EpisodeWorker] Task failed (${retryCount}/${MAX_RETRIES}). Moved to ${nextStatus}. Error: ${err.message}`);
  }
}
