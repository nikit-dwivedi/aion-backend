import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start securely.');
  // Use a dev fallback only if explicitly in dev mode
  console.warn('Using development fallback JWT_SECRET. Set JWT_SECRET in .env for production.');
}
const SECRET = JWT_SECRET || 'dev_aion_secret_' + Date.now();

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.error('[Auth] No authorization token provided');
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Malformed authorization token' });
  }

  try {
    const payload = jwt.verify(token, SECRET) as { userId: string };
    if (req.body) {
      req.body.userId = payload.userId; // For standard JSON payloads
    }
    (req as any).userId = payload.userId; // For Multipart and GET requests
    next();
  } catch (error) {
    console.error('[Auth] JWT Verification failed:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
