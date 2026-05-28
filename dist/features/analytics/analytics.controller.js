import {} from 'express';
import { AnalyticsService } from './analytics.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class AnalyticsController {
    static async getFocusAnalytics(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const result = await AnalyticsService.getFocusAnalytics(userId);
        res.json(result);
    }
    static async getBehavioralPatterns(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const result = await AnalyticsService.getBehavioralPatterns(userId);
        res.json(result);
    }
    static async getForecast(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const forecast = await AnalyticsService.getForecast(userId);
        res.json({ forecast });
    }
    static async getCognitionDashboard(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const result = await AnalyticsService.getCognitionDashboard(userId);
        res.json(result);
    }
}
//# sourceMappingURL=analytics.controller.js.map