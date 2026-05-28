import { type Request, type Response } from 'express';
export declare class AuthController {
    static register(req: Request, res: Response): Promise<void>;
    static login(req: Request, res: Response): Promise<void>;
    static getProfile(req: Request, res: Response): Promise<void>;
    static upgrade(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=auth.controller.d.ts.map