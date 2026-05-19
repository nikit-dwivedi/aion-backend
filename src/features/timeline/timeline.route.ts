import { Router } from 'express';
import { TimelineController } from './timeline.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(TimelineController.getTimeline));
router.get('/resurface', asyncHandler(TimelineController.getResurfaced));
router.get('/:id', asyncHandler(TimelineController.getMemoryDetail));
router.delete('/:id', asyncHandler(TimelineController.deleteMemory));

export default router;
