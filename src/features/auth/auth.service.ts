import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRepository } from './auth.repository.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class AuthService {
  static async register(email: string, password: string) {
    if (!email || !password) throw new AppError('Email and password required', 400);

    const existingUser = await AuthRepository.findUserByEmail(email);
    if (existingUser) throw new AppError('Email already exists', 400);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await AuthRepository.createUser(email, passwordHash);
    
    if (!user) throw new AppError('Failed to create user', 500);

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '30d' });
    return { token, userId: user.id };
  }

  static async login(email: string, password: string) {
    if (!email || !password) throw new AppError('Email and password required', 400);

    const user = await AuthRepository.findUserByEmail(email);
    
    if (!user) throw new AppError('Invalid credentials', 401);

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new AppError('Invalid credentials', 401);

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '30d' });
    return { token, userId: user.id };
  }
}
