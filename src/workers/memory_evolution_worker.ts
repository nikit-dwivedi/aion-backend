import { db } from '../db/index.js';
import { nodes, edges, events } from '../db/schema.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { llm } from '../services/llm.service.js';
import { cleanAndParseJson } from '../core/utils.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Memory Evolution Worker
 * Governs reinforcement counts, custom decay coefficients, temporal consolidation (episodes), and contradiction logs.
 */
export const startMemoryEvolutionWorker = () => {
  console.log('[MemoryEvolution] Starting Memory Evolution Engine worker...');

  // Cycle reinforcement, decay, and contradiction evaluation every 4 hours
  setInterval(async () => {
    try {
      await runMemoryEvolutionCycle();
    } catch (error) {
      console.error('[MemoryEvolution] Error during evolution cycle:', error);
    }
  }, 4 * 60 * 60 * 1000);

  // Run episodic consolidation every 12 hours
  setInterval(async () => {
    try {
      await runEpisodicClustering();
    } catch (error) {
      console.error('[MemoryEvolution] Error during episodic clustering:', error);
    }
  }, 12 * 60 * 60 * 1000);

  // Proactive Startup run after 40 seconds
  setTimeout(async () => {
    try {
      console.log('[MemoryEvolution] Running initial evolution & episodic clustering tasks...');
      await runMemoryEvolutionCycle();
      await runEpisodicClustering();
    } catch (e) {
      console.error('[MemoryEvolution] Startup evolution cycle failed:', e);
    }
  }, 40000);
};

// ─── Reinforcement, Decay, & Contradiction Audit ─────────────────────────────

async function runMemoryEvolutionCycle() {
  if (!llm.isConfigured) return;

  console.log('[MemoryEvolution] Running memory reinforcement and decay cycles...');

  // 1. Aggregated Reinforcement of Nodes based on Retrieval Logs
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const retrievals = await db.execute(sql`
    SELECT retrieved_node_id, COUNT(*)::int as count
    FROM retrieval_logs
    WHERE created_at > ${yesterday}
    GROUP BY retrieved_node_id
  `);

  for (const row of retrievals.rows) {
    const nodeId = row.retrieved_node_id as string;
    const count = row.count as number;

    const [targetNode] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!targetNode) continue;

    const userId = targetNode.userId;

    await db.execute(sql`
      UPDATE nodes
      SET reinforcement_count = reinforcement_count + ${count},
          last_reinforced_at = NOW(),
          cognitive_momentum = LEAST(1.0, cognitive_momentum + ${count * 0.1})
      WHERE id = ${nodeId}
    `);

    await db.insert(events).values({
      userId,
      eventType: 'memory_reinforced',
      payload: { nodeId, count },
      priority: 'low',
    });
  }

  // 2. Apply Custom Differentiated Decay on Edges
  // Decays edge weights based on source node types/metadata properties
  await db.execute(sql`
    UPDATE edges
    SET weight = weight * CASE
      WHEN EXISTS (
        SELECT 1 FROM nodes n 
        WHERE n.id = edges.source_node_id 
        AND (n.metadata->>'sentiment' = 'anxious' OR n.metadata->>'sentiment' = 'negative')
      ) THEN 0.98 -- Emotional anxiety decays very slowly
      WHEN EXISTS (SELECT 1 FROM nodes n WHERE n.id = edges.source_node_id AND n.node_type = 'action_item') THEN 0.95 -- Standard decay for goals
      WHEN EXISTS (SELECT 1 FROM nodes n WHERE n.id = edges.source_node_id AND n.node_type = 'research') THEN 0.92 -- Research decays moderately
      WHEN EXISTS (SELECT 1 FROM nodes n WHERE n.id = edges.source_node_id AND n.node_type = 'insight') THEN 0.90 -- Insights decay fast
      ELSE 0.95
    END
    WHERE relation_type NOT IN ('summarizes', 'belongs_to')
  `);

  // Decay general cognitive momentum on nodes
  await db.execute(sql`
    UPDATE nodes
    SET cognitive_momentum = GREATEST(0.0, cognitive_momentum - 0.05)
  `);

  // 3. Contradiction Tracking Audit
  const contradictions = await db.execute(sql`
    SELECT e.id as edge_id, e.source_node_id, e.target_node_id, n1.content as src_content, n2.content as tgt_content, n1.user_id
    FROM edges e
    JOIN nodes n1 ON e.source_node_id = n1.id
    JOIN nodes n2 ON e.target_node_id = n2.id
    WHERE e.relation_type = 'contradicts'
    AND NOT EXISTS (
      SELECT 1 FROM edges e2
      JOIN nodes n3 ON e2.source_node_id = n3.id
      WHERE n3.node_type = 'contradiction'
      AND e2.target_node_id = e.source_node_id
    )
    LIMIT 3
  `);

  for (const row of contradictions.rows) {
    const userId = row.user_id as string;
    const srcNodeId = row.source_node_id as string;
    const tgtNodeId = row.target_node_id as string;
    const srcText = row.src_content as string;
    const tgtText = row.tgt_content as string;

    const prompt = `
      You are AION's belief conflict and contradiction analyzer.
      The user has captured two conflicting ideas:
      Thought A: "${srcText}"
      Thought B: "${tgtText}"

      Identify the core unresolved inconsistency, emotional tension, or belief shift.
      Synthesize a concise contradiction description (1-2 sentences).
      Assess your confidence score in this contradiction (float 0.0 to 1.0) and describe the confidence source.

      Return a JSON object:
      {
        "inconsistency": "The contradiction summary statement",
        "confidence": 0.90,
        "confidenceSource": "Detailed explanation of source reliability"
      }
      Output ONLY raw JSON. No markdown.
    `;

    try {
      const response = await llm.generateContent({ prompt });
      const parsed = cleanAndParseJson(response);

      await db.transaction(async (tx) => {
        const [contradictionNode] = await tx.insert(nodes).values({
          userId,
          nodeType: 'contradiction',
          content: parsed.inconsistency,
          metadata: {
            confidenceScore: parsed.confidence || 0.8,
            confidenceSource: parsed.confidenceSource || 'Semantic discrepancy',
            verificationState: 'unverified',
            sourceNodeId: srcNodeId,
            targetNodeId: tgtNodeId
          }
        }).returning();

        if (contradictionNode) {
          // Link contradiction to both conflicting nodes
          await tx.insert(edges).values([
            { sourceNodeId: contradictionNode.id, targetNodeId: srcNodeId, relationType: 'episode_related', weight: parsed.confidence || 0.8 },
            { sourceNodeId: contradictionNode.id, targetNodeId: tgtNodeId, relationType: 'episode_related', weight: parsed.confidence || 0.8 }
          ]);
          console.log(`[MemoryEvolution] Persisted contradiction node ${contradictionNode.id} for user ${userId}`);
        }
      });
    } catch (err) {
      console.error('[MemoryEvolution] Contradiction audit failed:', err);
    }

    await delay(3000);
  }
}

// ─── Temporal Episodic Clustering ───────────────────────────────────────────

async function runEpisodicClustering() {
  if (!llm.isConfigured) return;

  console.log('[MemoryEvolution] Running episodic memory clustering...');

  // Find users with new unclustered memories in the last 48 hours
  const activeUsers = await db.execute(sql`
    SELECT DISTINCT user_id FROM nodes
    WHERE node_type = 'memory'
    AND created_at > NOW() - INTERVAL '48 hours'
  `);

  for (const user of activeUsers.rows) {
    const userId = user.user_id as string;

    // Fetch unclustered memories in a 48h window
    const unclustered = await db.execute(sql`
      SELECT id, content, created_at FROM nodes
      WHERE user_id = ${userId}
      AND node_type = 'memory'
      AND created_at > NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM edges e
        JOIN nodes n2 ON e.source_node_id = n2.id
        WHERE n2.node_type = 'episode'
        AND e.target_node_id = nodes.id
      )
      ORDER BY created_at ASC
    `);

    if (unclustered.rows.length < 3) continue; // Minimum cluster size of 3 memories

    // Format list for clustering analysis
    const listText = unclustered.rows.map((r: any, i: number) => `[ID: ${r.id}] Thought ${i + 1}: ${r.content} (${new Date(r.created_at).toLocaleTimeString()})`).join('\n');

    const prompt = `
      You are AION's episodic memory consolidator.
      Here is a chronological cluster of user thoughts created close in time:
      ${listText}

      Do these thoughts represent a single, cohesive temporal or emotional event or episode in the user's life (e.g., "Weekend Home Improvement Project", "Investor Pitch Stress", "Learning Flutter basics")?
      
      If yes, identify the related thought IDs and output:
      {
        "isEpisode": true,
        "title": "A short, meaningful name for the episode",
        "description": "1-2 sentences summarizing the overarching context of this episode",
        "confidence": 0.90,
        "matchingNodeIds": ["Array of IDs that belong to this episode"]
      }
      If no, return:
      { "isEpisode": false }
      Output ONLY raw JSON. No markdown.
    `;

    try {
      const response = await llm.generateContent({ prompt });
      const parsed = cleanAndParseJson(response);

      if (parsed.isEpisode && parsed.matchingNodeIds && parsed.matchingNodeIds.length >= 2) {
        await db.transaction(async (tx) => {
          // Create the episode node
          const [episodeNode] = await tx.insert(nodes).values({
            userId,
            nodeType: 'episode',
            content: parsed.description,
            metadata: {
              title: parsed.title,
              confidenceScore: parsed.confidence || 0.8,
              verificationState: 'verified'
            }
          }).returning();

          if (episodeNode) {
            // Link each memory to the episode
            for (const mid of parsed.matchingNodeIds) {
              await tx.insert(edges).values({
                sourceNodeId: episodeNode.id,
                targetNodeId: mid,
                relationType: 'part_of_episode',
                weight: parsed.confidence || 0.8
              });
            }
            console.log(`[MemoryEvolution] Created episode "${parsed.title}" for user ${userId} clustering ${parsed.matchingNodeIds.length} thoughts.`);
          }
        });
      }
    } catch (err) {
      console.error(`[MemoryEvolution] Episodic clustering failed for user ${userId}:`, err);
    }

    await delay(3000);
  }
}
