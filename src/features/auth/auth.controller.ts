import { type Request, type Response } from 'express';
import { AuthService } from './auth.service.js';

export class AuthController {
  static async register(req: Request, res: Response) {
    const { email, password } = req.body;
    const result = await AuthService.register(email, password);
    res.status(201).json(result);
  }

  static async login(req: Request, res: Response) {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    res.json(result);
  }
}
