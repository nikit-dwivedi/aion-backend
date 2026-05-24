import { Router } from 'express';
import multer from 'multer';
import { CaptureController } from './capture.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { checkQuota } from '../../core/middlewares/quota.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(authMiddleware);
router.use(checkQuota('capture'));

router.post('/', upload.single('media'), asyncHandler(CaptureController.captureMedia));
router.post('/pdf', upload.single('document'), asyncHandler(CaptureController.capturePdf));
router.post('/url', asyncHandler(CaptureController.captureUrl));

export default router;
