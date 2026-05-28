import {} from 'express';
import { SearchService } from './search.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class SearchController {
    static async search(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const { query } = req.body;
        const result = await SearchService.searchMemories(userId, query);
        res.json(result);
    }
}
//# sourceMappingURL=search.controller.js.map