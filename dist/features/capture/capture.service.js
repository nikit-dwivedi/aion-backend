import * as pdfParseModule from 'pdf-parse';
const pdfParse = pdfParseModule.default || pdfParseModule;
import * as cheerio from 'cheerio';
import { CaptureRepository } from './capture.repository.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
import dns from 'dns';
import { promisify } from 'util';
const dnsLookup = promisify(dns.lookup);
function isPrivateIp(ip) {
    if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1')
        return true;
    // Check IPv4 ranges
    const ipv4Parts = ip.split('.');
    if (ipv4Parts.length === 4) {
        const first = parseInt(ipv4Parts[0], 10);
        const second = parseInt(ipv4Parts[1], 10);
        // 10.0.0.0/8
        if (first === 10)
            return true;
        // 172.16.0.0/12
        if (first === 172 && (second >= 16 && second <= 31))
            return true;
        // 192.168.0.0/16
        if (first === 192 && second === 168)
            return true;
        // 169.254.0.0/16 (Link Local)
        if (first === 169 && second === 254)
            return true;
        // 0.0.0.0/8
        if (first === 0)
            return true;
    }
    // Check IPv6 ranges
    if (ip.includes(':')) {
        const lowerIp = ip.toLowerCase();
        if (lowerIp === '::' || lowerIp === '::1')
            return true;
        if (lowerIp.startsWith('fe80:'))
            return true;
        if (lowerIp.startsWith('fc00:') || lowerIp.startsWith('fd00:'))
            return true;
    }
    return false;
}
export async function validateUrlForSsrf(urlStr) {
    let parsedUrl;
    try {
        parsedUrl = new URL(urlStr);
    }
    catch (e) {
        throw new AppError('Invalid URL format', 400);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new AppError('Protocol must be http or https', 400);
    }
    const hostname = parsedUrl.hostname;
    if (!hostname) {
        throw new AppError('Invalid URL hostname', 400);
    }
    try {
        const { address } = await dnsLookup(hostname);
        if (isPrivateIp(address)) {
            throw new AppError('Access to private/local network address is blocked', 400);
        }
        return parsedUrl.toString();
    }
    catch (err) {
        if (err instanceof AppError)
            throw err;
        throw new AppError(`Failed to resolve host: ${hostname}`, 400);
    }
}
export class CaptureService {
    static async captureMedia(userId, type, content, mediaFile) {
        if (!type)
            throw new AppError('Missing required field: type', 400);
        const payload = { type };
        if ((type === 'audio' || type === 'image') && mediaFile) {
            payload.mediaBase64 = mediaFile.buffer.toString('base64');
            payload.mimeType = mediaFile.mimetype;
        }
        else if (type === 'text') {
            if (!content)
                throw new AppError('Missing text content', 400);
            payload.content = content;
        }
        else {
            throw new AppError('Invalid or missing content for type', 400);
        }
        return await CaptureRepository.insertMemoryEvent(userId, payload);
    }
    static async capturePdf(userId, file) {
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
    static async captureUrl(userId, url) {
        if (!url)
            throw new AppError('Missing url', 400);
        const validatedUrl = await validateUrlForSsrf(url);
        const response = await fetch(validatedUrl, {
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
//# sourceMappingURL=capture.service.js.map