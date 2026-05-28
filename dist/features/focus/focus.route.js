import { Router } from 'express';
import { FocusController } from './focus.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.use(authMiddleware);
router.get('/today', asyncHandler(FocusController.getFocusToday));
export default router;
//# sourceMappingURL=focus.route.js.map