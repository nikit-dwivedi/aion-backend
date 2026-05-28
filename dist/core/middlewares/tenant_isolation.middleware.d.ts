import { type Request, type Response, type NextFunction } from 'express';
/**
 * Tenant Isolation Middleware (Row-Level Security Session Binding)
 *
 * This middleware sets the PostgreSQL session variable `app.current_user_id`
 * which is used by RLS policies to restrict all queries to the current
 * authenticated user's data.
 *
 * Must be applied AFTER authMiddleware (which sets req.userId).
 *
 * How it works:
 *   1. authMiddleware verifies JWT and sets req.userId
 *   2. This middleware executes SET LOCAL on the pg session
 *   3. All subsequent queries in this request context are tenant-scoped by RLS
 *   4. SET LOCAL automatically resets when the transaction/connection returns to pool
 */
export declare const tenantIsolationMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=tenant_isolation.middleware.d.ts.map