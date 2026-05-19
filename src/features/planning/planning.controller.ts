import { type Request, type Response } from 'express';
import { PlanningService } from './planning.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class PlanningController {
  static async generateBreakdown(req: Request, res: Response) {
    const userId = req.userId;
    const { goal } = req.body;
    
    if (!userId) throw new AppError('Unauthorized', 401);

    const breakdown = await PlanningService.generateBreakdown(userId, goal);
    res.json({ breakdown });
  }

  static async generateSchedule(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const schedule = await PlanningService.generateSchedule(userId);
    res.json({ schedule });
  }
}
