import { type Request, type Response } from 'express';
import { GraphService } from './graph.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class GraphController {
  static async getGraph(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const result = await GraphService.getGraph(userId);
    res.json(result);
  }
}
