import { db } from '../db/index.js';
import { nodes, edges, events } from '../db/schema.js';
import { sql, eq, and } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { AnalyticsRepository } from '../features/analytics/analytics.repository.js';
import { cleanAndParseJson } from '../core/utils.js';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const DECAY_FACTOR = 0.95; // Weekly weight decay multiplier
const PRUNE_THRESHOLD = 0.2; // Remove edges below this weight
const MAX_DEGREE = 50; // Maximum edges per node (supernode cap)
/**
 * The Insight Engine runs periodically to:
 *   1. Detect behavioral, emotional, and productivity patterns in the user's mind graph
 *   2. Run graph compaction (edge decay + pruning + supernode gating)
 */
export const startInsightWorker = () => {
    console.log('[InsightWorker] Starting Insight Engine Worker...');
    // Check every hour for users needing pattern analysis
    setInterval(async () => {
        try {
            await runInsightEngine();
        }
        catch (error) {
            console.error('[InsightWorker] Error running engine:', error);
        }
    }, 60 * 60 * 1000);
    // Run graph compaction every 6 hours
    setInterval(async () => {
        try {
            await runGraphCompaction();
        }
        catch (error) {
            console.error('[InsightWorker] Graph compaction error:', error);
        }
    }, 6 * 60 * 60 * 1000);
    // Proactive run on worker boot after a small delay (15 seconds) to avoid boot congestion
    setTimeout(async () => {
        try {
            console.log('[InsightWorker] Performing startup check...');
            await runInsightEngine();
        }
        catch (e) {
            console.error('[InsightWorker] Startup check failed:', e);
        }
    }, 15000);
};
// ─── Graph Compaction (Entropic Decay) ───────────────────────────────────────
/**
 * Graph Compaction performs three operations:
 *   1. Edge Weight Decay: Multiply all edge weights by DECAY_FACTOR (0.95)
 *   2. Threshold Pruning: Delete edges whose weight has fallen below PRUNE_THRESHOLD (0.2)
 *   3. Supernode Gating: For nodes with > MAX_DEGREE edges, remove the weakest edges
 *
 * All operations run inside a single transaction for atomicity.
 */
async function runGraphCompaction() {
    console.log('[InsightWorker] Running graph compaction...');
    try {
        await db.transaction(async (tx) => {
            // 1. Edge Weight Decay: W = W × 0.95
            const decayResult = await tx.execute(sql `
        UPDATE edges
        SET weight = weight * ${DECAY_FACTOR}
        WHERE weight > ${PRUNE_THRESHOLD}
      `);
            console.log(`[InsightWorker] Decay applied to edges.`);
            // 2. Threshold Pruning: delete edges with weight < 0.2
            const pruneResult = await tx.execute(sql `
        DELETE FROM edges
        WHERE weight < ${PRUNE_THRESHOLD}
          AND relation_type NOT IN ('summarizes', 'belongs_to')
      `);
            console.log(`[InsightWorker] Pruned low-weight edges.`);
            // 3. Supernode Gating: remove excess edges from nodes with too many connections
            // Keep only the top MAX_DEGREE edges (by weight) per source node
            const supernodeResult = await tx.execute(sql `
        DELETE FROM edges
        WHERE id IN (
          SELECT id FROM (
            SELECT
              e.id,
              ROW_NUMBER() OVER (PARTITION BY e.source_node_id ORDER BY e.weight DESC) as rn
            FROM edges e
          ) ranked
          WHERE ranked.rn > ${MAX_DEGREE}
        )
      `);
            console.log(`[InsightWorker] Supernode gating completed.`);
        });
        console.log('[InsightWorker] Graph compaction finished successfully.');
    }
    catch (error) {
        console.error('[InsightWorker] Graph compaction failed:', error);
    }
}
async function runInsightEngine() {
    if (!llm.isConfigured) {
        console.warn('[InsightWorker] LLM is not configured. Skipping insight generation.');
        return;
    }
    // Find users who:
    // 1. Have at least 3 memories
    // 2. Either have no insight nodes, OR their latest insight is > 24 hours old
    //    AND they have added new memories since that latest insight node was created.
    const eligibleUsers = await db.execute(sql `
    SELECT u.id, u.email FROM users u
    WHERE (
      SELECT COUNT(*)::int FROM nodes m
      WHERE m.user_id = u.id AND m.node_type = 'memory'
    ) >= 3
    AND (
      NOT EXISTS (
        SELECT 1 FROM nodes n
        WHERE n.user_id = u.id AND n.node_type = 'insight'
      )
      OR (
        (SELECT MAX(created_at) FROM nodes n WHERE n.user_id = u.id AND n.node_type = 'insight') < NOW() - INTERVAL '24 hours'
        AND
        (SELECT MAX(created_at) FROM nodes m WHERE m.user_id = u.id AND m.node_type = 'memory') > 
        (SELECT MAX(created_at) FROM nodes n WHERE n.user_id = u.id AND n.node_type = 'insight')
      )
    )
  `);
    if (eligibleUsers.rows.length === 0) {
        return;
    }
    console.log(`[InsightWorker] Found ${eligibleUsers.rows.length} user(s) needing cognitive pattern analysis.`);
    for (const user of eligibleUsers.rows) {
        const userId = user.id;
        console.log(`[InsightWorker] Processing behavioral patterns for user ${userId} (${user.email})...`);
        try {
            await generateInsightsForUser(userId);
            console.log(`[InsightWorker] Insights generated and persisted for user ${userId}`);
        }
        catch (e) {
            console.error(`[InsightWorker] Failed generating insights for user ${userId}:`, e);
        }
        await delay(5000); // Friendly rate limiting space between users
    }
}
async function generateInsightsForUser(userId) {
    // 1. Fetch cognitive statistics & trends
    const topProjects = await AnalyticsRepository.getTopProjects(userId);
    const topEntities = await AnalyticsRepository.getTopEntities(userId);
    const concerns = await AnalyticsRepository.getRecurringConcerns(userId);
    const people = await AnalyticsRepository.getPeople(userId);
    // 2. Get last 15 memories for deep context
    const recentMemories = await db.execute(sql `
    SELECT content, created_at FROM nodes
    WHERE user_id = ${userId} AND node_type = 'memory'
    ORDER BY created_at DESC LIMIT 15
  `);
    // Format strings for prompt inclusion
    const projectsText = topProjects.rows.map((p) => `${p.project} (${p.mention_count} mentions)`).join(', ');
    const entitiesText = topEntities.rows.map((e) => `${e.entity} (${e.mention_count} mentions)`).join(', ');
    const concernsText = concerns.rows.map((c) => `${c.topic} (Negative sentiment context, repeated ${c.occurrences}x)`).join(', ');
    const peopleText = people.rows.map((p) => `${p.person} (${p.mentions} mentions)`).join(', ');
    const memoriesText = recentMemories.rows.map((m) => `- [${new Date(m.created_at).toLocaleDateString()}] ${m.content}`).join('\n');
    const prompt = `
    You are AION's behavioral and emotional pattern analyzer. Your job is to study the user's mind graph metrics, recurring themes, project focus areas, social connections, recurring anxieties, and recent raw memories to extract deep, highly personalized behavioral, productivity, or focus insights.
    
    COGNITIVE METRICS SUMMARY:
    - Active Focus Projects: ${projectsText || 'None detected yet'}
    - Top Mentioned Entities: ${entitiesText || 'None detected yet'}
    - Recurring Concerns (Fears, roadblocks, negative loops): ${concernsText || 'None detected yet'}
    - People Involved: ${peopleText || 'None detected yet'}
    
    RECENT MEMORY JOURNAL (Last 15 entries):
    ${memoriesText || 'No recent thought logs.'}
    
    TASK:
    Analyze the correlations in this user's data. Detect exactly 1 to 3 distinct, premium, highly accurate, and supportive "Proactive Insights".
    Examples of what to look for:
    - Sentiment correlation with projects (e.g. they feel stressed when discussing 'Project X').
    - Repetitive loops (they mention 'landing page' 4 times but have made no progress or lack an action item).
    - Creativity peak / pattern (when and where they excel).
    
    For each insight, you MUST return:
    1. Title: A short punchy title (e.g. "Focus Friction: Project X", "Weekly Momentum Loop").
    2. Content: 2-3 sentences explaining the pattern and the exact evidence from their memories.
    3. Recommendation: A supportive, highly practical, actionable suggestion.
    4. Type: 'behavioral', 'productivity', or 'focus'.
    5. Strength: A float score between 0.50 and 1.00 indicating confidence/severity.
    6. RelatedEntityOrProject: (Optional) The EXACT name of the project or entity this insight relates to from the user's metrics lists (null if none matches).
    
    Return a JSON object in exactly this format:
    {
      "insights": [
        {
          "title": "Focus Friction: Project X",
          "content": "You've captured 3 anxious thoughts this week relating to 'Project X'. The data shows a pattern of worry regarding deployment hurdles.",
          "recommendation": "Try scheduling a 30-minute drafting block specifically to map the deployment steps in small tasks.",
          "type": "behavioral",
          "strength": 0.85,
          "relatedEntityOrProject": "Project X"
        }
      ]
    }
    Output ONLY raw JSON. Do NOT wrap in markdown formatting (like \`\`\`json).
  `;
    let aiResponse = await llm.generateContent({ prompt });
    const parsed = cleanAndParseJson(aiResponse);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
        throw new Error('Invalid response structure from LLM');
    }
    // 3. Clear existing insight nodes for this user to keep data fresh and clean
    await db.delete(nodes).where(and(eq(nodes.userId, userId), eq(nodes.nodeType, 'insight')));
    // 4. Persist new insights and construct relevant edges
    for (const insight of parsed.insights) {
        const metadata = {
            title: insight.title,
            recommendation: insight.recommendation,
            type: insight.type || 'behavioral',
            strength: Number(insight.strength) || 0.8,
            relatedEntityOrProject: insight.relatedEntityOrProject || null
        };
        // Insert as an insight node
        const [insertedNode] = await db.insert(nodes).values({
            userId,
            nodeType: 'insight',
            content: insight.content,
            metadata: metadata,
        }).returning();
        // 5. Check if we need to link this insight to a related Project or Entity node
        if (insight.relatedEntityOrProject) {
            const matchName = insight.relatedEntityOrProject.trim();
            const relatedNodes = await db.select()
                .from(nodes)
                .where(and(eq(nodes.userId, userId), sql `LOWER(content) = LOWER(${matchName})`, sql `node_type IN ('project', 'entity')`))
                .limit(1);
            if (relatedNodes.length > 0) {
                const targetNode = relatedNodes[0];
                if (!insertedNode || !targetNode) {
                    return;
                }
                // Create edge from insight to the project/entity
                await db.insert(edges).values({
                    sourceNodeId: insertedNode.id,
                    targetNodeId: targetNode.id,
                    relationType: 'relates_to',
                    weight: metadata.strength,
                });
                console.log(`[InsightWorker] Connected insight node "${metadata.title}" -> "${targetNode.content}" (${targetNode.nodeType})`);
            }
        }
    }
    // Log the event that fresh insights were generated
    await db.insert(events).values({
        userId,
        eventType: 'insights_generated',
        payload: { count: parsed.insights.length },
    });
}
//# sourceMappingURL=insight_worker.js.map