import { type Request, type Response } from 'express';
import { CaptureService } from './capture.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class CaptureController {
  static async captureMedia(req: Request, res: Response) {
    const { content, type } = req.body;
    const userId = req.userId;
    const mediaFile = req.file;

    if (!userId) throw new AppError('Unauthorized', 401);

    const event = await CaptureService.captureMedia(userId, type, content, mediaFile);
    res.status(201).json({ message: "Got it. You don't need to hold this in your head anymore.", event });
  }

  static async capturePdf(req: Request, res: Response) {
    const userId = req.userId;
    const file = req.file;

    if (!userId) throw new AppError('Unauthorized', 401);
    if (!file) throw new AppError('Missing document file', 400);

    const result = await CaptureService.capturePdf(userId, file);
    res.status(201).json({ message: "Got it. You don't need to hold this in your head anymore.", ...result });
  }

  static async captureUrl(req: Request, res: Response) {
    const userId = req.userId;
    const { url } = req.body;

    if (!userId) throw new AppError('Unauthorized', 401);

    const result = await CaptureService.captureUrl(userId, url);
    res.status(201).json({ message: "Got it. You don't need to hold this in your head anymore.", ...result });
  }
  static async retryCapture(req: Request, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) throw new AppError('Unauthorized', 401);
    if (!id || typeof id !== 'string') throw new AppError('Missing event ID', 400);

    const result = await CaptureService.retryCapture(userId, id);
    res.status(200).json({ message: "Retry queued.", event: result });
  }
}
