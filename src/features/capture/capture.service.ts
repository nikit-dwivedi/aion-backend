import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import * as cheerio from 'cheerio';
import { CaptureRepository } from './capture.repository.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class CaptureService {
  static async captureMedia(userId: string, type: string, content?: string, mediaFile?: Express.Multer.File) {
    if (!type) throw new AppError('Missing required field: type', 400);

    const payload: any = { type };

    if ((type === 'audio' || type === 'image') && mediaFile) {
      payload.mediaBase64 = mediaFile.buffer.toString('base64');
      payload.mimeType = mediaFile.mimetype;
    } else if (type === 'text') {
      if (!content) throw new AppError('Missing text content', 400);
      payload.content = content;
    } else {
      throw new AppError('Invalid or missing content for type', 400);
    }

    return await CaptureRepository.insertMemoryEvent(userId, payload);
  }

  static async capturePdf(userId: string, file: Express.Multer.File) {
    const pdfData = await pdfParse(file.buffer);
    const extractedText = pdfData.text?.trim();

    if (!extractedText || extractedText.length < 10) {
      throw new AppError('Could not extract meaningful text from PDF', 400);
    }

    const content = extractedText.length > 5000 
      ? extractedText.substring(0, 5000) + '...[truncated]' 
      : extractedText;

    const payload = {
      type: 'text',
      content,
      source: 'pdf',
      originalFilename: file.originalname,
      pageCount: pdfData.numpages,
    };

    const event = await CaptureRepository.insertMemoryEvent(userId, payload);
    return { event, stats: { pages: pdfData.numpages, characters: extractedText.length } };
  }

  static async captureUrl(userId: string, url: string) {
    if (!url) throw new AppError('Missing url', 400);

    const response = await fetch(url, { 
      headers: { 'User-Agent': 'AION-Cognitive-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new AppError(`Failed to fetch URL: ${response.status}`, 400);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, footer, header, aside, iframe, noscript').remove();
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
    let bodyText = $('article').text().trim() || $('main').text().trim() || $('body').text().trim();
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

    if (bodyText.length < 20) {
      throw new AppError('Could not extract meaningful content from URL', 400);
    }

    const content = bodyText.length > 5000 ? bodyText.substring(0, 5000) + '...[truncated]' : bodyText;

    const payload = {
      type: 'text',
      content: `[${title}]\n${content}`,
      source: 'url',
      sourceUrl: url,
    };

    const event = await CaptureRepository.insertMemoryEvent(userId, payload);
    return { event, stats: { title, characters: content.length } };
  }
}
