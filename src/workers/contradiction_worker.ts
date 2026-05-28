import { db } from '../db/index.js';
import { nodes, edges } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { queueProvider } from '../core/queue.js';
import { withAdvisoryLock, LOCK_GRAPH_MUTATION } from '../core/locks.js';
import { llm } from '../services/llm.service.js';
import { cleanAndParseJson } from '../core/utils.js';
import { CognitionLogger } from '../core/observability.ts';

const MAX_RETRIES = 5;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const startContradictionWorker = () => {
  console.log('[ContradictionWorker] Starting Contradiction Processing Worker...');

  // Subscribe to background queue
  queueProvider.subscribe('background_evolution_queue', async (msg) => {
    if (msg.eventType === 'contradiction_requested') {
      try {
        await processContradictionEvent(msg.id);
      } catch (err) {
        console.error(`[ContradictionWorker] Event handler error for event ${msg.id}:`, err);
      }
    }
  });

  // Sweep fallback
  setInterval(async () => {
    try {
      await sweepPendingContradictions();
    } catch (err) {
      console.error('[ContradictionWorker] Sweep error:', err);
    }
  }, 120000);
};

async function sweepPendingContradictions(): Promise<void> {
  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'contradiction_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 3
  `);

  for (const row of pending.rows) {
    await processContradictionEvent(row.id as string);
  }
}

async function processContradictionEvent(eventId: string): Promise<void> {
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
    const lockAcquired = await withAdvisoryLock(LOCK_GRAPH_MUTATION, async (tx) => {
      // Find candidate contradiction edges for this user
      const contradictions = await tx.execute(sql`
        SELECT e.id as edge_id, e.source_node_id, e.target_node_id, n1.content as src_content, n2.content as tgt_content
        FROM edges e
        JOIN nodes n1 ON e.source_node_id = n1.id
        JOIN nodes n2 ON e.target_node_id = n2.id
        WHERE n1.user_id = ${userId}
        AND e.relation_type = 'contradicts'
        AND NOT EXISTS (
          SELECT 1 FROM edges e2
          JOIN nodes n3 ON e2.source_node_id = n3.id
          WHERE n3.node_type = 'contradiction'
          AND n3.user_id = ${userId}
          AND e2.target_node_id = e.source_node_id
        )
        LIMIT 3
      `);

      let detectedCount = 0;

      for (const row of contradictions.rows) {
        const srcNodeId = row.source_node_id as string;
        const tgtNodeId = row.target_node_id as string;
        const srcText = row.src_content as string;
        const tgtText = row.tgt_content as string;

        // Idempotency: Double check that we don't already have a contradiction node linking these two
        const duplicateCheck = await tx.execute(sql`
          SELECT n.id FROM nodes n
          WHERE n.node_type = 'contradiction'
          AND n.user_id = ${userId}
          AND (n.metadata->>'sourceNodeId' = ${srcNodeId} AND n.metadata->>'targetNodeId' = ${tgtNodeId})
          LIMIT 1
        `);

        if (duplicateCheck.rows.length > 0) {
          continue; // Already processed
        }

        const prompt = `
          You are AION's belief conflict and contradiction analyzer.
          The user has captured two conflicting ideas:
          Thought A: "${srcText}"
          Thought B: "${tgtText}"

          Identify the core unresolved inconsistency, emotional tension, or belief shift.
          Synthesize a concise contradiction description (1-2 sentences).
          Assess your confidence score in this contradiction (float 0.0 to 1.0) and describe the confidence source.

          Return a JSON object:
          {
            "inconsistency": "The contradiction summary statement",
            "confidence": 0.90,
            "confidenceSource": "Detailed explanation of source reliability"
          }
          Output ONLY raw JSON. No markdown.
        `;

        try {
          const response = await llm.generateContent({
            prompt,
            subsystem: 'contradiction',
            priority: 'low'
          });
          
          const parsed = cleanAndParseJson(response);
          const confidence = parsed.confidence || 0.8;

          const [contradictionNode] = await tx.insert(nodes).values({
            userId,
            nodeType: 'contradiction',
            content: parsed.inconsistency,
            metadata: {
              confidenceScore: confidence,
              confidenceSource: parsed.confidenceSource || 'Semantic discrepancy',
              verificationState: 'tentative', // Default verification state is tentative (non-authoritative)
              evidenceSources: [
                { nodeId: srcNodeId, content: srcText },
                { nodeId: tgtNodeId, content: tgtText }
              ],
              sourceNodeId: srcNodeId,
              targetNodeId: tgtNodeId
            }
          }).returning();

          if (contradictionNode) {
            await tx.insert(edges).values([
              { sourceNodeId: contradictionNode.id, targetNodeId: srcNodeId, relationType: 'episode_related', weight: confidence },
              { sourceNodeId: contradictionNode.id, targetNodeId: tgtNodeId, relationType: 'episode_related', weight: confidence }
            ]);
            detectedCount++;
          }
        } catch (err: any) {
          console.error(`[ContradictionWorker] Error generating contradiction audit:`, err.message);
        }

        await delay(1000); // Small rate limit delay
      }

      // Complete event
      await tx.execute(sql`
        UPDATE events
        SET processing_status = 'completed'
        WHERE id = ${eventId}
      `);

      CognitionLogger.log({
        subsystem: 'contradiction',
        action: 'contradiction_completed',
        userId,
        outputs: { newContradictions: detectedCount },
        latencyMs: Date.now() - startTime,
        reason: `Audited thoughts and enqueued ${detectedCount} tentative contradiction nodes for user ${userId}.`,
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

    console.error(`[ContradictionWorker] Task failed (${retryCount}/${MAX_RETRIES}). Moved to ${nextStatus}. Error: ${err.message}`);
  }
}
