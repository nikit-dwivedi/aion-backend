import { ProjectsRepository } from './projects.repository.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class ProjectsService {
    static async getProjects(userId) {
        const projects = await ProjectsRepository.getProjects(userId);
        const enriched = await Promise.all(projects.map(async (proj) => {
            const linkedMemories = await ProjectsRepository.getLinkedMemories(proj.id, userId);
            const linkedEntities = await ProjectsRepository.getLinkedEntities(proj.id, userId);
            return {
                ...proj,
                memoryCount: linkedMemories.rows.length,
                memories: linkedMemories.rows,
                entities: linkedEntities.rows.map((r) => r.content),
            };
        }));
        return enriched;
    }
    static async moveMemoryToProject(memoryId, newProjectName, userId) {
        if (!memoryId || !newProjectName)
            throw new AppError('Missing memoryId or newProjectName', 400);
        await ProjectsRepository.moveMemoryToProject(memoryId, newProjectName, userId);
    }
}
//# sourceMappingURL=projects.service.js.map