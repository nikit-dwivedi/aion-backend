import { db } from '../db/index.js';
import { nodes, events } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { queueProvider } from '../core/queue.js';
import { withAdvisoryLock, LOCK_REINFORCEMENT } from '../core/locks.js';
import { CognitionService } from '../services/cognition.service.js';
import { CognitionLogger } from '../core/observability.js';
import { insertEvent } from '../core/events.js';
const MAX_RETRIES = 5;
export const startReinforcementWorker = () => {
    console.log('[ReinforcementWorker] Starting Reinforcement Processing Worker...');
    // Subscribe to the isolated background queue
    queueProvider.subscribe('background_evolution_queue', async (msg) => {
        if (msg.eventType === 'reinforcement_requested') {
            try {
                await processReinforcementEvent(msg.id);
            }
            catch (err) {
                console.error(`[ReinforcementWorker] Event handler error for event ${msg.id}:`, err);
            }
        }
    });
    // Sweep fallback for missed reinforcement events
    setInterval(async () => {
        try {
            await sweepPendingReinforcements();
        }
        catch (err) {
            console.error('[ReinforcementWorker] Sweep error:', err);
        }
    }, 120000); // Every 2 minutes
};
async function sweepPendingReinforcements() {
    const pending = await db.execute(sql `
    SELECT id FROM events
    WHERE event_type = 'reinforcement_requested'
    AND processing_status IN ('pending', 'retrying')
    AND retry_count < ${MAX_RETRIES}
    ORDER BY created_at ASC
    LIMIT 3
  `);
    for (const row of pending.rows) {
        await processReinforcementEvent(row.id);
    }
}
async function processReinforcementEvent(eventId) {
    // Claim event atomically
    const claimRes = await db.execute(sql `
    UPDATE events
    SET processing_status = 'processing'
    WHERE id = ${eventId}
    AND processing_status IN ('pending', 'retrying')
    RETURNING *
  `);
    if (claimRes.rows.length === 0) {
        return; // Already claimed or processed
    }
    const eventRow = claimRes.rows[0];
    const userId = eventRow.user_id;
    const startTime = Date.now();
    try {
        // Execute inside reinforcement transaction advisory lock
        const lockAcquired = await withAdvisoryLock(LOCK_REINFORCEMENT, async (tx) => {
            // 1. Fetch retrieval counts for this user in the last 24 hours
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const retrievals = await tx.execute(sql `
        SELECT retrieved_node_id, COUNT(*)::int as count
        FROM retrieval_logs
        WHERE user_id = ${userId}
        AND created_at > ${yesterday}
        GROUP BY retrieved_node_id
      `);
            let totalReinforced = 0;
            for (const row of retrievals.rows) {
                const nodeId = row.retrieved_node_id;
                const count = row.count;
                const [node] = await tx.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
                if (!node)
                    continue;
                const { reinforcementCount, cognitiveMomentum } = CognitionService.calculateReinforcement(node.reinforcementCount, Number(node.cognitiveMomentum), count);
                await tx.execute(sql `
          UPDATE nodes
          SET reinforcement_count = ${reinforcementCount},
              last_reinforced_at = NOW(),
              cognitive_momentum = ${cognitiveMomentum}
          WHERE id = ${nodeId}
        `);
                totalReinforced += count;
                await insertEvent(tx, {
                    userId,
                    eventType: 'memory_reinforced',
                    payload: { nodeId, count },
                    priority: 'background',
                });
            }
            // Mark the reinforcement task completed
            await tx.execute(sql `
        UPDATE events
        SET processing_status = 'completed'
        WHERE id = ${eventId}
      `);
            CognitionLogger.log({
                subsystem: 'reinforcement',
                action: 'reinforcement_completed',
                userId,
                inputs: { yesterdayLimit: yesterday },
                outputs: { totalReinforcedNodes: retrievals.rows.length, totalCount: totalReinforced },
                latencyMs: Date.now() - startTime,
                reason: `Processed daily memory reinforcements based on retrieval logs for user ${userId}.`,
            });
            return true;
        });
        if (!lockAcquired) {
            // Release claim since lock is held, retry later
            await db.execute(sql `
        UPDATE events
        SET processing_status = 'retrying'
        WHERE id = ${eventId}
      `);
        }
    }
    catch (err) {
        const retryCount = (eventRow.retry_count || 0) + 1;
        const isDlq = retryCount >= MAX_RETRIES;
        const nextStatus = isDlq ? 'dead_lettered' : 'retrying';
        const errorMessage = err?.stack || err?.message || String(err);
        await db.execute(sql `
      UPDATE events
      SET processing_status = ${nextStatus},
          retry_count = ${retryCount},
          last_error = ${errorMessage}
      WHERE id = ${eventId}
    `);
        console.error(`[ReinforcementWorker] Task failed (${retryCount}/${MAX_RETRIES}). Moved to ${nextStatus}. Error: ${err.message}`);
    }
}
//# sourceMappingURL=reinforcement_worker.js.map