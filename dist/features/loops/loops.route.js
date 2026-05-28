import { Router } from 'express';
import { LoopsController } from './loops.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.use(authMiddleware);
router.get('/', asyncHandler(LoopsController.getLoops));
router.post('/:id/resolve', asyncHandler(LoopsController.resolveLoop));
router.post('/:id/archive', asyncHandler(LoopsController.archiveLoop));
router.post('/:id/snooze', asyncHandler(LoopsController.snoozeLoop));
export default router;
//# sourceMappingURL=loops.route.js.map