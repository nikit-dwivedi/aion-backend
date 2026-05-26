import { Router } from 'express';
import { DeepDiveService } from './deepdive.service.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { checkQuota } from '../../core/middlewares/quota.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const router = Router();
const deepDiveService = new DeepDiveService();

router.use(authMiddleware);

// GET /deepdive/:rawThoughtId
router.get('/:rawThoughtId', asyncHandler(async (req: any, res: any) => {
  const userId = req.userId;
  const { rawThoughtId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const result = await deepDiveService.getThoughtHistory(userId, rawThoughtId);
  res.json(result);
}));

// POST /deepdive/:rawThoughtId/chat
router.post('/:rawThoughtId/chat', checkQuota('deepdive'), asyncHandler(async (req: any, res: any) => {
  const userId = req.userId;
  const { rawThoughtId } = req.params;
  const { message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing userId or message' });
  }

  const result = await deepDiveService.chatWithThought(userId, rawThoughtId, message);
  res.json(result);
}));

export default router;
