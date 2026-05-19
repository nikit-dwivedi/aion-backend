import { Router } from 'express';
import { PlanningController } from './planning.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.use(authMiddleware);

router.post('/breakdown', asyncHandler(PlanningController.generateBreakdown));
router.post('/schedule', asyncHandler(PlanningController.generateSchedule));

export default router;
