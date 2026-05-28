import {} from 'express';
import { TimelineService } from './timeline.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class TimelineController {
    static async getTimeline(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const memories = await TimelineService.getTimeline(userId);
        res.json({ memories });
    }
    static async getResurfaced(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const memories = await TimelineService.getResurfaced(userId);
        res.json({ memories });
    }
    static async getMemoryDetail(req, res) {
        const userId = req.userId;
        const memoryId = req.params.id;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const result = await TimelineService.getMemoryDetail(userId, memoryId);
        res.json(result);
    }
    static async deleteMemory(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const memoryId = req.params.id;
        await TimelineService.deleteMemory(memoryId, userId);
        res.json({ success: true });
    }
}
//# sourceMappingURL=timeline.controller.js.map