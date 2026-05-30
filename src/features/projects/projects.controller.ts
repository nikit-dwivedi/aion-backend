import { type Request, type Response } from 'express';
import { ProjectsService } from './projects.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class ProjectsController {
  static async getProjects(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const projects = await ProjectsService.getProjects(userId, limit, cursor);
    res.json({ projects });
  }

  static async moveMemoryToProject(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);
    const { memoryId, newProjectName } = req.body;
    await ProjectsService.moveMemoryToProject(memoryId, newProjectName, userId);
    res.json({ success: true });
  }
}
