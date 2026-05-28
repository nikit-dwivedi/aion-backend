import { db } from '../../db/index.js';
import { events } from '../../db/schema.js';
export class CaptureRepository {
    static async insertMemoryEvent(userId, payload) {
        const [event] = await db.insert(events).values({
            userId,
            eventType: 'memory_created',
            payload
        }).returning();
        return event;
    }
}
//# sourceMappingURL=capture.repository.js.map