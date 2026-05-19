import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export class AuthRepository {
  static async findUserByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  static async createUser(email: string, passwordHash: string) {
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    return user;
  }
}
