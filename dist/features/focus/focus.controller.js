import {} from 'express';
import { FocusService } from '../../services/focus.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class FocusController {
    static async getFocusToday(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const focusData = await FocusService.getFocusToday(userId);
        res.json(focusData);
    }
}
//# sourceMappingURL=focus.controller.js.map