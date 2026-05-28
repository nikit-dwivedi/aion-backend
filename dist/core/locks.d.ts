export declare const LOCK_EPISODIC_CLUSTERING = 1001;
export declare const LOCK_REINFORCEMENT = 1002;
export declare const LOCK_NOTIFICATION = 1003;
export declare const LOCK_PLAN_ORCHESTRATION = 1004;
export declare const LOCK_GRAPH_MUTATION = 1005;
/**
 * Runs a callback inside a PostgreSQL transaction-level advisory lock.
 * Transaction advisory locks are automatically released when the transaction ends
 * (either committed or rolled back). This prevents lock leaks.
 *
 * Returns the callback result, or null if lock could not be acquired.
 */
export declare function withAdvisoryLock<T>(key: number, callback: (tx: any) => Promise<T>): Promise<T | null>;
//# sourceMappingURL=locks.d.ts.map