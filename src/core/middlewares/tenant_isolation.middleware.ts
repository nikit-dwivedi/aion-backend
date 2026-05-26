import { type Request, type Response, type NextFunction } from 'express';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';

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
export const tenantIsolationMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.userId;

  if (!userId) {
    // If no userId, RLS will block all access (secure by default)
    return next();
  }

  try {
    // Bind the authenticated user's ID to the PostgreSQL session.
    // This is read by RLS policies: current_setting('app.current_user_id', true)
    await db.execute(sql`SELECT set_config('app.current_user_id', ${userId}, false)`);
    next();
  } catch (err) {
    console.error('[TenantIsolation] Failed to bind user session:', err);
    next(err);
  }
};
