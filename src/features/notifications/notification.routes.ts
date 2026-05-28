import { Router } from 'express';
import { db } from '../../db/index.js';
import { notifications } from '../../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
import { CognitionLogger } from '../../core/observability.js';

const router = Router();

router.use(authMiddleware);

/**
 * Capture user interaction feedback signals for future adaptive notification fatigue modeling.
 * Signals logged: click time, dismissal speed, engagement depth, contextual receptivity.
 */
router.post('/:id/feedback', asyncHandler(async (req: any, res: any) => {
  const userId = req.userId;
  const notificationId = req.params.id;
  const { 
    dismissalVelocity, 
    clickLatencyMs, 
    engagementDepth, 
    contextualReceptivity 
  } = req.body;

  if (!userId) throw new AppError('Unauthorized', 401);

  // Verify notification belongs to user
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!existing || existing.userId !== userId) {
    throw new AppError('Notification not found', 404);
  }

  // Update dismissal velocity in notifications
  await db.execute(sql`
    UPDATE notifications
    SET dismissal_velocity = ${dismissalVelocity || 0.0},
        delivery_status = 'delivered'
    WHERE id = ${notificationId}
  `);

  // Log signals for future adaptive learning parser
  CognitionLogger.log({
    subsystem: 'notification',
    action: 'interaction_logged',
    userId,
    inputs: { 
      notificationId, 
      clickLatencyMs, 
      engagementDepth, 
      contextualReceptivity,
      dismissalVelocity 
    },
    reason: `Logged user engagement feedback metrics for notification ${notificationId}`
  });

  res.json({ success: true, message: 'Notification interaction signal logged successfully.' });
}));

export default router;
