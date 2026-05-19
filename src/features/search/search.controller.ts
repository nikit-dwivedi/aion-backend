import { type Request, type Response } from 'express';
import { SearchService } from './search.service.js';

export class SearchController {
  static async search(req: Request, res: Response) {
    const { query } = req.body;
    const result = await SearchService.searchMemories(query);
    res.json(result);
  }
}
