import { type Request, type Response } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class AnalyticsController {
  static async getFocusAnalytics(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const result = await AnalyticsService.getFocusAnalytics(userId);
    res.json(result);
  }

  static async getBehavioralPatterns(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const result = await AnalyticsService.getBehavioralPatterns(userId);
    res.json(result);
  }

  static async getForecast(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const forecast = await AnalyticsService.getForecast(userId);
    res.json({ forecast });
  }
}
