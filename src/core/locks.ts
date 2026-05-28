import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

export const LOCK_EPISODIC_CLUSTERING = 1001;
export const LOCK_REINFORCEMENT = 1002;
export const LOCK_NOTIFICATION = 1003;
export const LOCK_PLAN_ORCHESTRATION = 1004;
export const LOCK_GRAPH_MUTATION = 1005;

/**
 * Runs a callback inside a PostgreSQL transaction-level advisory lock.
 * Transaction advisory locks are automatically released when the transaction ends
 * (either committed or rolled back). This prevents lock leaks.
 * 
 * Returns the callback result, or null if lock could not be acquired.
 */
export async function withAdvisoryLock<T>(
  key: number,
  callback: (tx: any) => Promise<T>
): Promise<T | null> {
  return await db.transaction(async (tx) => {
    const lockRes = await tx.execute(sql`SELECT pg_try_xact_advisory_lock(${key}) as acquired`);
    const acquired = lockRes.rows[0]?.acquired;
    if (!acquired) {
      console.warn(`[Lock] Could not acquire transaction advisory lock for key ${key}. Concurrency protection active.`);
      return null;
    }
    return await callback(tx);
  });
}
