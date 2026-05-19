import { Router } from 'express';
import { AnalyticsController } from './analytics.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/focus', asyncHandler(AnalyticsController.getFocusAnalytics));
router.get('/patterns', asyncHandler(AnalyticsController.getBehavioralPatterns));

export default router;
