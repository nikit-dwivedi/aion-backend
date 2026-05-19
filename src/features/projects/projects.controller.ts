import { type Request, type Response } from 'express';
import { ProjectsService } from './projects.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class ProjectsController {
  static async getProjects(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const projects = await ProjectsService.getProjects(userId);
    res.json({ projects });
  }

  static async moveMemoryToProject(req: Request, res: Response) {
    const { memoryId, newProjectName, userId = '123e4567-e89b-12d3-a456-426614174000' } = req.body;
    await ProjectsService.moveMemoryToProject(memoryId, newProjectName, userId);
    res.json({ success: true });
  }
}
