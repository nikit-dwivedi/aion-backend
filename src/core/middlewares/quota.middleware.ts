import { type Request, type Response, type NextFunction } from 'express';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { AppError } from './error.middleware.js';

/**
 * Middleware to check if a user is within their subscription tier's usage limits.
 */
export const checkQuota = (feature: 'capture' | 'deepdive' | 'research') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) {
      return next(new AppError('Authentication required', 401));
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return next(new AppError('User not found', 404));
      }

      // Pro Tier users have unlimited access
      if (user.tier === 'pro') {
        return next();
      }

      // Free Tier restrictions
      if (feature === 'research') {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: 'Autonomous research is a Premium Pro feature. Please upgrade to unlock.'
        });
      }

      if (feature === 'capture') {
        if (user.llmUsage >= 20) {
          return res.status(403).json({
            status: 'error',
            code: 'quota_exceeded',
            message: 'You have reached the limit of 20 thoughts on the Free Tier. Please upgrade to Pro.'
          });
        }
      }

      if (feature === 'deepdive') {
        if (user.llmUsage >= 20) {
          return res.status(403).json({
            status: 'error',
            code: 'quota_exceeded',
            message: 'You have reached your Free Tier conversation limits. Please upgrade to Pro.'
          });
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Helper utility to increment user's LLM usage.
 */
export const incrementUsage = async (userId: string) => {
  try {
    await db.update(users)
      .set({ llmUsage: sql`llm_usage + 1` })
      .where(eq(users.id, userId));
  } catch (err) {
    console.error(`[Quota] Failed to increment usage for user ${userId}:`, err);
  }
};
