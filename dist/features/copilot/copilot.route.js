import { Router } from 'express';
import { CopilotController } from './copilot.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.use(authMiddleware);
router.post('/generate', asyncHandler(CopilotController.generateInsights));
router.get('/insights', asyncHandler(CopilotController.getInsights));
router.get('/nudge', asyncHandler(CopilotController.getNudge));
router.post('/chat', asyncHandler(CopilotController.chat));
export default router;
//# sourceMappingURL=copilot.route.js.map