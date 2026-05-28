import { Router } from 'express';
import { SearchController } from './search.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.use(authMiddleware);
router.post('/', asyncHandler(SearchController.search));
export default router;
//# sourceMappingURL=search.route.js.map