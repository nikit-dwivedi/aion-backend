import { type Request, type Response } from 'express';
import { AuthService } from './auth.service.js';

export class AuthController {
  static async register(req: Request, res: Response) {
    const { email, password, timezone } = req.body;
    const result = await AuthService.register(email, password, timezone);
    res.status(201).json(result);
  }

  static async login(req: Request, res: Response) {
    const { email, password, timezone } = req.body;
    const result = await AuthService.login(email, password, timezone);
    res.json(result);
  }

  static async getProfile(req: Request, res: Response) {
    const userId = req.userId!;
    const result = await AuthService.getProfile(userId);
    res.json(result);
  }

  static async upgrade(req: Request, res: Response) {
    const userId = req.userId!;
    const result = await AuthService.upgradeToPro(userId);
    res.json(result);
  }
}
