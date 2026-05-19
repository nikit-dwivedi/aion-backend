import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from './error.middleware.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next(new AppError('No authorization token provided', 401));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new AppError('Malformed authorization token', 401));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 401));
  }
};
