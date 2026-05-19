import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.post('/register', asyncHandler(AuthController.register));
router.post('/login', asyncHandler(AuthController.login));

export default router;
