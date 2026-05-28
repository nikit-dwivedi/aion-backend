import {} from 'express';
import { GraphService } from './graph.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class GraphController {
    static async getGraph(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const result = await GraphService.getGraph(userId);
        res.json(result);
    }
}
//# sourceMappingURL=graph.controller.js.map