import { type Request, type Response } from 'express';
import { db } from '../../db/index.js';
import { loops } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class LoopsController {
  static async getLoops(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);

    const userLoops = await db
      .select()
      .from(loops)
      .where(eq(loops.userId, userId))
      .orderBy(desc(loops.lastSeenAt));

    res.json({ loops: userLoops });
  }

  static async resolveLoop(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);
    const loopId = req.params.id as string;

    const [updated] = await db
      .update(loops)
      .set({
        status: 'resolved',
        updatedAt: new Date(),
      })
      .where(and(eq(loops.id, loopId), eq(loops.userId, userId)))
      .returning();

    if (!updated) throw new AppError('Loop not found or unauthorized', 404);

    res.json({
      success: true,
      message: "Outstanding! You've successfully closed this loop. Your mind is lighter.",
      loop: updated
    });
  }

  static async archiveLoop(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);
    const loopId = req.params.id as string;

    const [updated] = await db
      .update(loops)
      .set({
        status: 'archived',
        updatedAt: new Date(),
      })
      .where(and(eq(loops.id, loopId), eq(loops.userId, userId)))
      .returning();

    if (!updated) throw new AppError('Loop not found or unauthorized', 404);

    res.json({
      success: true,
      message: "Archived. You've cleared this concern from your focus.",
      loop: updated
    });
  }

  static async snoozeLoop(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401);
    const loopId = req.params.id as string;
    const { days } = req.body;

    const daysCount = Number(days) || 1;
    const snoozedUntil = new Date(Date.now() + daysCount * 24 * 60 * 60 * 1000);

    const [updated] = await db
      .update(loops)
      .set({
        status: 'dormant', // Snoozed loop marks as dormant until time expires
        snoozedUntil,
        updatedAt: new Date(),
      })
      .where(and(eq(loops.id, loopId), eq(loops.userId, userId)))
      .returning();

    if (!updated) throw new AppError('Loop not found or unauthorized', 404);

    res.json({
      success: true,
      message: "Got it. We've paused this thought so you don't have to carry it for now.",
      loop: updated
    });
  }
}
