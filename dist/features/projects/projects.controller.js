import {} from 'express';
import { ProjectsService } from './projects.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class ProjectsController {
    static async getProjects(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const projects = await ProjectsService.getProjects(userId);
        res.json({ projects });
    }
    static async moveMemoryToProject(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const { memoryId, newProjectName } = req.body;
        await ProjectsService.moveMemoryToProject(memoryId, newProjectName, userId);
        res.json({ success: true });
    }
}
//# sourceMappingURL=projects.controller.js.map