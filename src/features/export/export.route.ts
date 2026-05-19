import { Router } from 'express';
import { ExportController } from './export.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(ExportController.exportData));

export default router;
