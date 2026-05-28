import { Router } from 'express';
import multer from 'multer';
import { CaptureController } from './capture.controller.js';
import { authMiddleware } from '../../core/middlewares/auth.middleware.js';
import { checkQuota } from '../../core/middlewares/quota.middleware.js';
import { asyncHandler } from '../../core/middlewares/error.middleware.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/mp4',
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'application/pdf'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new AppError(`File type ${file.mimetype} is not allowed.`, 400), false);
        }
    }
});
const router = Router();
router.use(authMiddleware);
router.use(checkQuota('capture'));
router.post('/', upload.single('media'), asyncHandler(CaptureController.captureMedia));
router.post('/pdf', upload.single('document'), asyncHandler(CaptureController.capturePdf));
router.post('/url', asyncHandler(CaptureController.captureUrl));
export default router;
//# sourceMappingURL=capture.route.js.map