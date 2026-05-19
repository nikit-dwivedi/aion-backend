import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { events } from '../db/schema.ts';
import multer from 'multer';
// @ts-ignore
import * as pdfParse from 'pdf-parse';
import * as cheerio from 'cheerio';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// POST /api/capture - Standard capture (text, audio, image)
router.post('/', upload.single('media'), async (req: Request, res: Response) => {
  try {
    const { content, type } = req.body;
    const userId = (req as any).userId;
    const mediaFile = req.file;

    if (!userId || !type) {
      return res.status(400).json({ error: 'Missing required fields: userId, type' });
    }

    let payload: any = { type };
    
    if ((type === 'audio' || type === 'image') && mediaFile) {
      payload.mediaBase64 = mediaFile.buffer.toString('base64');
      payload.mimeType = mediaFile.mimetype;
    } else if (type === 'text') {
      if (!content) return res.status(400).json({ error: 'Missing text content' });
      payload.content = content;
    } else {
      return res.status(400).json({ error: 'Invalid or missing content for type' });
    }

    const newEvent = await db.insert(events).values({
      userId,
      eventType: 'memory_created',
      payload
    }).returning();

    return res.status(201).json({
      message: 'Event logged successfully',
      event: newEvent[0]
    });
  } catch (error) {
    console.error('Error logging capture event:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/capture/pdf - PDF document upload
router.post('/pdf', upload.single('document'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const file = req.file;

    if (!userId || !file) {
      return res.status(400).json({ error: 'Missing userId or document file' });
    }

    // Extract text from PDF
    const pdfData = await pdfParse(file.buffer);
    const extractedText = pdfData.text?.trim();

    if (!extractedText || extractedText.length < 10) {
      return res.status(400).json({ error: 'Could not extract meaningful text from PDF' });
    }

    // Truncate to 5000 chars for LLM processing
    const content = extractedText.length > 5000 
      ? extractedText.substring(0, 5000) + '...[truncated]'
      : extractedText;

    const newEvent = await db.insert(events).values({
      userId,
      eventType: 'memory_created',
      payload: { 
        type: 'text', 
        content,
        source: 'pdf',
        originalFilename: file.originalname,
        pageCount: pdfData.numpages,
      }
    }).returning();

    return res.status(201).json({
      message: 'PDF processed successfully',
      event: newEvent[0],
      stats: { pages: pdfData.numpages, characters: extractedText.length },
    });
  } catch (error) {
    console.error('Error processing PDF:', error);
    return res.status(500).json({ error: 'Failed to process PDF' });
  }
});

// POST /api/capture/url - URL/bookmark capture
router.post('/url', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { url } = req.body;

    if (!userId || !url) {
      return res.status(400).json({ error: 'Missing userId or url' });
    }

    // Fetch page content
    const response = await fetch(url, { 
      headers: { 'User-Agent': 'AION-Cognitive-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL: ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, aside, iframe, noscript').remove();

    // Extract title + main content
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
    
    // Try article/main content first, fallback to body
    let bodyText = $('article').text().trim() 
      || $('main').text().trim() 
      || $('body').text().trim();
    
    // Clean whitespace
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

    if (bodyText.length < 20) {
      return res.status(400).json({ error: 'Could not extract meaningful content from URL' });
    }

    // Truncate for LLM
    const content = bodyText.length > 5000 
      ? bodyText.substring(0, 5000) + '...[truncated]'
      : bodyText;

    const newEvent = await db.insert(events).values({
      userId,
      eventType: 'memory_created',
      payload: { 
        type: 'text', 
        content: `[${title}]\n${content}`,
        source: 'url',
        sourceUrl: url,
      }
    }).returning();

    return res.status(201).json({
      message: 'URL captured successfully',
      event: newEvent[0],
      stats: { title, characters: content.length },
    });
  } catch (error) {
    console.error('Error capturing URL:', error);
    return res.status(500).json({ error: 'Failed to capture URL content' });
  }
});

export default router;
