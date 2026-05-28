import { type Request, type Response, type NextFunction } from 'express';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { AppError } from './error.middleware.js';

// Governance limits for subscription tiers
export const TIER_LIMITS = {
  free: {
    dailyInferenceTokens: 10000,
    researchRequests: 0, // Blocked
    planningExecutions: 5,
    retrievalQueries: 20,
    insightGenerations: 2,
  },
  pro: {
    dailyInferenceTokens: 500000, // Safe infinite loop limit
    researchRequests: 100,
    planningExecutions: 50,
    retrievalQueries: 500,
    insightGenerations: 10,
  }
};

/**
 * Checks and resets daily quota counters if the reset interval has passed.
 */
const checkAndResetDailyQuotas = async (user: any) => {
  const resetInterval = 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - new Date(user.lastUsageResetAt).getTime();
  
  if (ageMs > resetInterval) {
    await db.update(users)
      .set({
        dailyInferenceTokens: 0,
        researchRequests: 0,
        planningExecutions: 0,
        retrievalQueries: 0,
        insightGenerations: 0,
        lastUsageResetAt: new Date()
      })
      .where(eq(users.id, user.id));
      
    user.dailyInferenceTokens = 0;
    user.researchRequests = 0;
    user.planningExecutions = 0;
    user.retrievalQueries = 0;
    user.insightGenerations = 0;
  }
};

/**
 * Middleware to check if a user is within their subscription tier's usage limits.
 */
export const checkQuota = (feature: 'capture' | 'deepdive' | 'research' | 'planning' | 'retrieval' | 'insights') => {
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

      // Check for daily resets
      await checkAndResetDailyQuotas(user);

      const tier = (user.tier === 'pro' ? 'pro' : 'free') as 'pro' | 'free';
      const limits = TIER_LIMITS[tier];

      // Rate limit check: Daily Inference Token usage
      if (user.dailyInferenceTokens >= limits.dailyInferenceTokens) {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: `Daily inference token quota reached (${user.dailyInferenceTokens}/${limits.dailyInferenceTokens} tokens). Please wait or upgrade.`
        });
      }

      if (feature === 'research' && user.researchRequests >= limits.researchRequests) {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: tier === 'free' 
            ? 'Autonomous research is a Premium Pro feature. Please upgrade to unlock.'
            : 'You have reached your daily premium research limit. Please try again tomorrow.'
        });
      }

      if (feature === 'planning' && user.planningExecutions >= limits.planningExecutions) {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: 'Daily plan execution quota reached. Please try again tomorrow.'
        });
      }

      if (feature === 'retrieval' && user.retrievalQueries >= limits.retrievalQueries) {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: 'Daily search and retrieval query quota reached. Please try again tomorrow.'
        });
      }

      if (feature === 'insights' && user.insightGenerations >= limits.insightGenerations) {
        return res.status(403).json({
          status: 'error',
          code: 'quota_exceeded',
          message: 'Daily cognitive insight generations quota reached. Please try again tomorrow.'
        });
      }

      // Capture and Deepdive fallbacks
      if (feature === 'capture' || feature === 'deepdive') {
        if (user.llmUsage >= 20 && tier === 'free') {
          return res.status(403).json({
            status: 'error',
            code: 'quota_exceeded',
            message: 'You have reached the limit of 20 thoughts on the Free Tier. Please upgrade to Pro.'
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
 * Helper utility to increment user's dynamic quota counters.
 */
export const incrementQuotaUsage = async (
  userId: string,
  metrics: {
    tokens?: number;
    research?: boolean;
    planning?: boolean;
    retrieval?: boolean;
    insights?: boolean;
  }
) => {
  try {
    const updates: any = {};
    if (metrics.tokens) {
      updates.dailyInferenceTokens = sql`daily_inference_tokens + ${metrics.tokens}`;
      updates.monthlyInferenceTokens = sql`monthly_inference_tokens + ${metrics.tokens}`;
    }
    if (metrics.research) updates.researchRequests = sql`research_requests + 1`;
    if (metrics.planning) updates.planningExecutions = sql`planning_executions + 1`;
    if (metrics.retrieval) updates.retrievalQueries = sql`retrieval_queries + 1`;
    if (metrics.insights) updates.insightGenerations = sql`insight_generations + 1`;
    
    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, userId));
    }
  } catch (err) {
    console.error(`[Quota] Failed to increment usage for user ${userId}:`, err);
  }
};

/**
 * Backwards compatible legacy usage counter
 */
export const incrementUsage = async (userId: string) => {
  try {
    await db.update(users)
      .set({ llmUsage: sql`llm_usage + 1` })
      .where(eq(users.id, userId));
    await incrementQuotaUsage(userId, { tokens: 1000 }); // Default estimate
  } catch (err) {
    console.error(`[Quota] Legacy usage increment failed:`, err);
  }
};

