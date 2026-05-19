import { Router } from 'express';
import { ProjectsController } from './projects.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(ProjectsController.getProjects));
router.patch('/move', asyncHandler(ProjectsController.moveMemoryToProject));

export default router;
