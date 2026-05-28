import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
export class AuthRepository {
    static async findUserByEmail(email) {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user;
    }
    static async createUser(email, passwordHash, timezone) {
        const [user] = await db.insert(users).values({ email, passwordHash, ...(timezone ? { timezone } : {}) }).returning();
        return user;
    }
}
//# sourceMappingURL=auth.repository.js.map