import { db } from '../db/index.js';
import { loops, nodes } from '../db/schema.js';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { AppError } from '../core/middlewares/error.middleware.js';
export class FocusService {
    /**
     * Generates the ultra-minimal Focus Daily summary for a user.
     */
    static async getFocusToday(userId) {
        // 1. Fetch loops and apply dynamic decay/dormancy transitions
        const userLoops = await db
            .select()
            .from(loops)
            .where(and(eq(loops.userId, userId), inArray(loops.status, ['emerging', 'active', 'persistent', 'critical', 'relapsing'])));
        const now = new Date();
        const updatedLoops = [];
        for (const lp of userLoops) {
            const lastSeen = new Date(lp.lastSeenAt);
            const diffMs = now.getTime() - lastSeen.getTime();
            const daysSinceSeen = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
            if (daysSinceSeen > 14) {
                // Transition loop to dormant in the DB
                await db
                    .update(loops)
                    .set({ status: 'dormant', updatedAt: now })
                    .where(eq(loops.id, lp.id));
                console.log(`[Focus] Loop "${lp.title}" moved to dormant due to 14+ days inactivity.`);
            }
            else {
                // Apply 15% daily decay to emotionalWeight internally
                let decayedWeight = lp.avoidanceScore; // Using avoidanceScore as the emotional anchor
                if (daysSinceSeen >= 1.0) {
                    decayedWeight = lp.avoidanceScore * Math.pow(0.85, Math.floor(daysSinceSeen));
                }
                updatedLoops.push({
                    ...lp,
                    avoidanceScore: decayedWeight // Decayed weight representation
                });
            }
        }
        // 2. Fetch pending action items
        const actionItems = await db
            .select({ id: nodes.id })
            .from(nodes)
            .where(and(eq(nodes.userId, userId), eq(nodes.nodeType, 'action_item'), sql `COALESCE(metadata->>'status', 'pending') = 'pending'`));
        // 3. Fetch memories in the last 7 days
        const recentMems = await db
            .select({ id: nodes.id, createdAt: nodes.createdAt, metadata: nodes.metadata })
            .from(nodes)
            .where(and(eq(nodes.userId, userId), eq(nodes.nodeType, 'memory'), sql `created_at >= NOW() - INTERVAL '7 days'`));
        const totalRecent = recentMems.length;
        const negativeCount = recentMems.filter(m => {
            const meta = m.metadata;
            return meta?.sentiment === 'negative' || meta?.sentiment === 'anxious';
        }).length;
        // Late night check (10 PM to 5 AM)
        const lateNightCount = recentMems.filter(m => {
            const hour = new Date(m.createdAt).getHours();
            return hour >= 22 || hour < 5;
        }).length;
        // 4. Compute Cognitive Pressure Score (0-100)
        // - Active loops weight component (35%): Number of active loops and their weight
        const activeCount = updatedLoops.length;
        const avgWeight = updatedLoops.reduce((acc, l) => acc + l.avoidanceScore, 0) / (activeCount || 1);
        const loopsComp = Math.min(35, activeCount * 8 + avgWeight * 15);
        // - Pending action items (20%): 4 points per pending action item
        const actionComp = Math.min(20, actionItems.length * 4);
        // - Memory volume in last 7 days (15%): 1 point per memory
        const volumeComp = Math.min(15, totalRecent * 1);
        // - Negative sentiment ratio (15%)
        const negRatio = totalRecent > 0 ? (negativeCount / totalRecent) : 0;
        const sentimentComp = Math.min(15, negRatio * 15);
        // - Late night captures (15%): 5 points per late night memory
        const lateNightComp = Math.min(15, lateNightCount * 5);
        const pressureScore = Math.round(loopsComp + actionComp + volumeComp + sentimentComp + lateNightComp);
        // 5. Select Primary & Secondary Loops
        // Sort loops by decayed avoidanceScore desc
        const sortedLoops = [...updatedLoops].sort((a, b) => b.avoidanceScore - a.avoidanceScore);
        const primaryLoop = sortedLoops[0] || null;
        const secondaryLoops = sortedLoops.slice(1, 3);
        // 6. Build Greeting, Closure Recommendation, and POETIC non-clinical Insight
        let greeting = "Good morning. Let's bring some clarity to your mind today.";
        const currentHour = new Date().getHours();
        if (currentHour >= 12 && currentHour < 17) {
            greeting = "Good afternoon. Take a breath and let go of what you don't need.";
        }
        else if (currentHour >= 17) {
            greeting = "Good evening. Rest easy, we've got your thoughts safely stored.";
        }
        let closureSuggestion = "Take a small, simple step to unload your mind today.";
        if (primaryLoop) {
            closureSuggestion = `For "${primaryLoop.title}": Try writing a one-line decision or scheduling a brief focus window to resolve it.`;
        }
        let reflectionInsight = "Your mind graph is currently quiet. A wonderful space for fresh clarity.";
        if (primaryLoop) {
            if (primaryLoop.avoidanceScore > 0.8) {
                reflectionInsight = `You've been carrying the thought of "${primaryLoop.title}" for a while. Let's write it down and close it.`;
            }
            else if (lateNightCount > 3) {
                reflectionInsight = `This thought pattern repeatedly appears late at night. Try writing it down earlier to sleep easier.`;
            }
            else {
                reflectionInsight = `The concern regarding "${primaryLoop.title}" has been active recently.`;
            }
        }
        else if (totalRecent === 0) {
            reflectionInsight = "No worries captured recently. Take a moment to enjoy the mental space.";
        }
        // Return the ultra-minimal Focus payload
        return {
            greeting,
            cognitivePressureScore: pressureScore,
            primaryLoop: primaryLoop ? {
                id: primaryLoop.id,
                title: primaryLoop.title,
                summary: primaryLoop.summary,
                primaryEmotion: primaryLoop.primaryEmotion,
                loopCategory: primaryLoop.loopCategory,
                repetitionCount: primaryLoop.repetitionCount,
            } : null,
            secondaryLoops: secondaryLoops.map(l => ({
                id: l.id,
                title: l.title,
                summary: l.summary,
                primaryEmotion: l.primaryEmotion,
                loopCategory: l.loopCategory,
                repetitionCount: l.repetitionCount,
            })),
            closureSuggestion,
            reflectionInsight
        };
    }
}
//# sourceMappingURL=focus.service.js.map