import { type Request, type Response } from 'express';
import { CopilotService } from './copilot.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class CopilotController {
  static async generateInsights(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const insights = await CopilotService.generateInsights(userId);
    res.json({ insights });
  }

  static async getInsights(req: Request, res: Response) {
    const insights = await CopilotService.getInsights();
    res.json({ insights });
  }

  static async getNudge(req: Request, res: Response) {
    const nudge = await CopilotService.getNudge();
    res.json({ nudge });
  }

  static async chat(req: Request, res: Response) {
    const { message, conversationHistory } = req.body;
    if (!message) throw new AppError('Missing message', 400);

    const reply = await CopilotService.chat(message, conversationHistory);
    res.json({ reply });
  }
}
