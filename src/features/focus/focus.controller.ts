import { type Request, type Response } from 'express';
import { FocusService } from '../../services/focus.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class FocusController {
  static async getFocusToday(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const focusData = await FocusService.getFocusToday(userId);
    res.json(focusData);
  }
}
