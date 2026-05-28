import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
const router = Router();
router.post('/register', asyncHandler(AuthController.register));
router.post('/login', asyncHandler(AuthController.login));
router.get('/profile', authMiddleware, asyncHandler(AuthController.getProfile));
router.post('/upgrade', authMiddleware, asyncHandler(AuthController.upgrade));
export default router;
//# sourceMappingURL=auth.route.js.map