import {} from 'express';
import { AuthService } from './auth.service.js';
export class AuthController {
    static async register(req, res) {
        const { email, password, timezone } = req.body;
        const result = await AuthService.register(email, password, timezone);
        res.status(201).json(result);
    }
    static async login(req, res) {
        const { email, password, timezone } = req.body;
        const result = await AuthService.login(email, password, timezone);
        res.json(result);
    }
    static async getProfile(req, res) {
        const userId = req.userId;
        const result = await AuthService.getProfile(userId);
        res.json(result);
    }
    static async upgrade(req, res) {
        const userId = req.userId;
        const result = await AuthService.upgradeToPro(userId);
        res.json(result);
    }
}
//# sourceMappingURL=auth.controller.js.map