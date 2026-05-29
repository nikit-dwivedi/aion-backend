import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRepository } from './auth.repository.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/middlewares/error.middleware.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { normalizeTimezone } from '../../core/utils.js';

export class AuthService {
  static async register(email: string, password: string, timezone?: string) {
    if (!email || !password) throw new AppError('Email and password required', 400);

    const existingUser = await AuthRepository.findUserByEmail(email);
    if (existingUser) throw new AppError('Email already exists', 400);

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedTz = normalizeTimezone(timezone);
    const user = await AuthRepository.createUser(email, passwordHash, normalizedTz);
    
    if (!user) throw new AppError('Failed to create user', 500);

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '30d' });
    const { passwordHash: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword };
  }

  static async login(email: string, password: string, timezone?: string) {
    if (!email || !password) throw new AppError('Email and password required', 400);

    const user = await AuthRepository.findUserByEmail(email);
    
    if (!user) throw new AppError('Invalid credentials', 401);

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new AppError('Invalid credentials', 401);

    // Sync timezone on login if provided
    if (timezone) {
      const normalizedTz = normalizeTimezone(timezone);
      if (user.timezone !== normalizedTz) {
        await db.update(users).set({ timezone: normalizedTz }).where(eq(users.id, user.id));
      }
    }

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '30d' });
    const { passwordHash: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword };
  }

  static async getProfile(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        timezone: users.timezone,
        tier: users.tier,
        llmUsage: users.llmUsage,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new AppError('User not found', 404);
    return user;
  }

  static async upgradeToPro(userId: string) {
    const [updatedUser] = await db
      .update(users)
      .set({ tier: 'pro' })
      .where(eq(users.id, userId))
      .returning({ id: users.id, tier: users.tier });

    if (!updatedUser) throw new AppError('User not found', 404);
    return updatedUser;
  }
}
