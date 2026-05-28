import {} from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from './error.middleware.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return next(new AppError('No authorization token provided', 401));
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return next(new AppError('Malformed authorization token', 401));
    }
    try {
        const payload = jwt.verify(token, env.JWT_SECRET);
        req.userId = payload.userId;
        next();
    }
    catch (error) {
        return next(new AppError('Invalid or expired token', 401));
    }
};
//# sourceMappingURL=auth.middleware.js.map