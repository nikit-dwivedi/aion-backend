import {} from 'express';
import { ExportService } from './export.service.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
export class ExportController {
    static async exportData(req, res) {
        const userId = req.userId;
        if (!userId)
            throw new AppError('Unauthorized', 401);
        const exportData = await ExportService.getExportData(userId);
        res.setHeader('Content-Disposition', 'attachment; filename="aion-export.json"');
        res.json(exportData);
    }
}
//# sourceMappingURL=export.controller.js.map