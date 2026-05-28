import { Router } from 'express';
import { GraphController } from './graph.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.use(authMiddleware);
router.get('/', asyncHandler(GraphController.getGraph));
export default router;
//# sourceMappingURL=graph.route.js.map