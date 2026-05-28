import { type Request, type Response } from 'express';
export declare class LoopsController {
    static getLoops(req: Request, res: Response): Promise<void>;
    static resolveLoop(req: Request, res: Response): Promise<void>;
    static archiveLoop(req: Request, res: Response): Promise<void>;
    static snoozeLoop(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=loops.controller.d.ts.map