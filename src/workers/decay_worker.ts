import { db } from '../db/index.js';
import { nodes, edges } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { queueProvider } from '../core/queue.js';
import { withAdvisoryLock, LOCK_GRAPH_MUTATION } from '../core/locks.js';
import { CognitionService } from '../services/cognition.service.js';
import { CognitionLogger } from '../core/observability.ts';

const MAX_RETRIES = 5;

export const startDecayWorker = () => {
  console.log('[DecayWorker] Starting Decay Processing Worker...');

  // Subscribe to background queue
  queueProvider.subscribe('background_evolution_queue', async (msg) => {
    if (msg.eventType === 'decay_requested') {
      try {
        await processDecayEvent(msg.id);
      } catch (err) {
        console.error(`[DecayWorker] Event handler error for event ${msg.id}:`, err);
      }
    }
  });

  // Sweep fallback
  setInterval(async () => {
    try {
      await sweepPendingDecays();
    } catch (err) {
      console.error('[DecayWorker] Sweep error:', err);
    }
  }, 120000);
};

async function sweepPendingDecays(): Promise<void> {
  const pending = await db.execute(sql`
    SELECT id FROM events
    WHERE event_type = 'decay_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 3
  `);

  for (const row of pending.rows) {
    await processDecayEvent(row.id as string);
  }
}

async function processDecayEvent(eventId: string): Promise<void> {
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
      // 1. Fetch and decay edges for this user
      const userEdges = await tx.execute(sql`
        SELECT e.id, e.relation_type, e.weight, n.node_type, n.metadata
        FROM edges e
        JOIN nodes n ON e.source_node_id = n.id
        WHERE n.user_id = ${userId}
        AND e.relation_type NOT IN ('summarizes', 'belongs_to')
      `);

      let edgesDecayed = 0;
      for (const row of userEdges.rows) {
        const id = row.id as string;
        const relType = row.relation_type as string;
        const weight = Number(row.weight);
        const nodeType = row.node_type as string;
        const metadata = row.metadata as any;
        const sentiment = metadata?.sentiment;

        const decayedWeight = CognitionService.calculateEdgeDecay(relType, nodeType, sentiment, weight);
        if (decayedWeight !== weight) {
          await tx.execute(sql`
            UPDATE edges
            SET weight = ${decayedWeight}
            WHERE id = ${id}
          `);
          edgesDecayed++;
        }
      }

      // 2. Fetch and decay cognitive momentum on nodes for this user
      const userNodes = await tx.execute(sql`
        SELECT id, cognitive_momentum
        FROM nodes
        WHERE user_id = ${userId}
        AND cognitive_momentum > 0.0
      `);

      let nodesDecayed = 0;
      for (const row of userNodes.rows) {
        const id = row.id as string;
        const momentum = Number(row.cognitive_momentum);

        const decayedMomentum = CognitionService.calculateNodeDecay(momentum);
        await tx.execute(sql`
          UPDATE nodes
          SET cognitive_momentum = ${decayedMomentum}
          WHERE id = ${id}
        `);
        nodesDecayed++;
      }

      // Complete event
      await tx.execute(sql`
        UPDATE events
        SET processing_status = 'completed'
        WHERE id = ${eventId}
      `);

      CognitionLogger.log({
        subsystem: 'decay',
        action: 'decay_completed',
        userId,
        outputs: { edgesDecayed, nodesDecayed },
        latencyMs: Date.now() - startTime,
        reason: `Applied customized differentiated decay coefficients on edges and nodes momentum for user ${userId}.`,
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

    console.error(`[DecayWorker] Task failed (${retryCount}/${MAX_RETRIES}). Moved to ${nextStatus}. Error: ${err.message}`);
  }
}
