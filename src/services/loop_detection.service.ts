import { db } from '../db/index.js';
import { loops, nodes } from '../db/schema.js';
import { llm } from './llm.service.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { cleanAndParseJson } from '../core/utils.js';

// Helper: Calculate cosine similarity locally between two embeddings
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class LoopDetectionService {
  /**
   * Run the Stage 1 + Stage 2 loop detection pipeline for a user.
   */
  static async detectLoops(userId: string): Promise<void> {
    if (!llm.isConfigured) {
      console.warn('[LoopDetection] LLM not configured. Skipping loop detection.');
      return;
    }

    // 1. Fetch user's recent memories (last 50)
    const recentMemories = await db
      .select({
        id: nodes.id,
        content: nodes.content,
        embedding: nodes.embedding,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(and(eq(nodes.nodeType, 'memory'), eq(nodes.userId, userId)))
      .orderBy(desc(nodes.createdAt))
      .limit(50);

    if (recentMemories.length < 2) {
      return; // Need at least two thoughts to check for recurrence
    }

    // Filter memories that have valid embeddings
    const memoriesWithEmbed = recentMemories.filter(m => m.embedding && m.embedding.length > 0);
    if (memoriesWithEmbed.length < 2) return;

    // 2. STAGE 1: Deterministic Clustering
    // Build adjacency list for memories with distance < 0.25 (Similarity > 0.75)
    const SIMILARITY_THRESHOLD = 0.75;
    const adj: Record<string, string[]> = {};
    for (const m of memoriesWithEmbed) {
      adj[m.id] = [];
    }

    for (let i = 0; i < memoriesWithEmbed.length; i++) {
      for (let j = i + 1; j < memoriesWithEmbed.length; j++) {
        const m1 = memoriesWithEmbed[i]!;
        const m2 = memoriesWithEmbed[j]!;
        const sim = cosineSimilarity(m1.embedding!, m2.embedding!);
        if (sim >= SIMILARITY_THRESHOLD) {
          adj[m1.id]!.push(m2.id);
          adj[m2.id]!.push(m1.id);
        }
      }
    }

    // Find connected components (clusters)
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const mId of Object.keys(adj)) {
      if (!visited.has(mId)) {
        const cluster: string[] = [];
        const queue = [mId];
        visited.add(mId);

        while (queue.length > 0) {
          const curr = queue.shift()!;
          cluster.push(curr);
          for (const neighbor of adj[curr]!) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        if (cluster.length >= 2) {
          clusters.push(cluster);
        }
      }
    }

    if (clusters.length === 0) {
      console.log(`[LoopDetection] No semantic loop candidates found for user ${userId}.`);
      return;
    }

    console.log(`[LoopDetection] Found ${clusters.length} loop candidate(s) for user ${userId}.`);

    // Fetch existing active/snoozed loops
    const activeLoops = await db
      .select()
      .from(loops)
      .where(and(eq(loops.userId, userId), inArray(loops.status, ['emerging', 'active', 'persistent', 'critical', 'relapsing', 'snoozed'])));

    // 3. STAGE 2: LLM Interpretation & Merge
    for (const clusterIds of clusters) {
      const clusterMemories = memoriesWithEmbed.filter(m => clusterIds.includes(m.id));
      
      // Determine if this cluster overlaps with any existing loop
      let matchedLoop = activeLoops.find(lp => {
        const existingIds = lp.relatedMemoryIds as string[];
        return clusterIds.some(id => existingIds.includes(id));
      });

      // Prompt the LLM to interpret the cluster thoughts
      const prompt = `
        You are AION's cognitive loop interpreter.
        A "mental loop" is a recurring concern, repetitive thought, unresolved decision, or circular emotional worry.
        
        We have identified a cluster of related thoughts captured by the user:
        ${clusterMemories.map(m => `- ${m.content}`).join('\n')}
        
        Provide a clean, supportive, non-clinical interpretation of this recurring theme.
        
        Choose a loopCategory from: 'career' | 'finance' | 'relationships' | 'burnout' | 'self-worth' | 'health' | 'identity' | 'uncertainty' | 'other'.
        Choose a primaryEmotion from: 'anxiety' | 'fear' | 'sadness' | 'stress' | 'frustration' | 'guilt' | 'hope' | 'neutral'.
        
        Determine:
        - title: A short, calm, user-facing label (e.g., "Designing the landing page" or "Anxiety about team sync syncs").
        - summary: A supportive, reflective description of the pattern (1-2 sentences). Do NOT be clinical or diagnostic. Avoid medical words like depression, ADHD, OCD, clinically anxious, etc. Speak supportively (e.g., "You are reflecting on X and feeling uncertain about Y").
        - primaryEmotion: The dominant emotion.
        - loopCategory: The matching category.
        - avoidanceScore: Float between 0.0 and 1.0 (1.0 if they seem to avoid addressing or deciding on it, 0.0 if they actively work on it).
        - triggerPatterns: 1-3 short text descriptions of what triggers this (e.g. "Work syncs", "Late nights", "Financial tracking").
        - resolutionConfidence: Float between 0.0 and 1.0 (how solvable does this concern feel based on user notes).

        Return a JSON object:
        {
          "title": "...",
          "summary": "...",
          "primaryEmotion": "...",
          "loopCategory": "...",
          "avoidanceScore": 0.35,
          "triggerPatterns": ["...", "..."],
          "resolutionConfidence": 0.60
        }
        Output ONLY raw JSON. No markdown.
      `;

      try {
        const aiResponse = await llm.generateContent({ prompt });
        const parsed = cleanAndParseJson(aiResponse);

        const currentMemoryIds = clusterIds;
        
        if (matchedLoop) {
          // Merge with existing loop
          const mergedMemoryIds = Array.from(new Set([...(matchedLoop.relatedMemoryIds as string[]), ...currentMemoryIds]));
          const repCount = mergedMemoryIds.length;
          
          let newStatus = matchedLoop.status;
          if (matchedLoop.status === 'resolved') {
            newStatus = 'relapsing';
          } else {
            if (repCount === 2) newStatus = 'emerging';
            else if (repCount >= 3) {
              const ageDays = (Date.now() - new Date(matchedLoop.firstSeenAt).getTime()) / (1000 * 60 * 60 * 24);
              if (ageDays > 7) {
                newStatus = 'persistent';
              } else {
                newStatus = 'active';
              }
            }
            if (parsed.avoidanceScore > 0.75 && repCount >= 5) {
              newStatus = 'critical';
            }
          }

          await db
            .update(loops)
            .set({
              title: parsed.title || matchedLoop.title,
              summary: parsed.summary || matchedLoop.summary,
              primaryEmotion: parsed.primaryEmotion || matchedLoop.primaryEmotion,
              loopCategory: parsed.loopCategory || matchedLoop.loopCategory,
              avoidanceScore: parsed.avoidanceScore !== undefined ? Number(parsed.avoidanceScore) : matchedLoop.avoidanceScore,
              resolutionConfidence: parsed.resolutionConfidence !== undefined ? Number(parsed.resolutionConfidence) : matchedLoop.resolutionConfidence,
              triggerPatterns: parsed.triggerPatterns || matchedLoop.triggerPatterns,
              repetitionCount: repCount,
              relatedMemoryIds: mergedMemoryIds,
              lastSeenAt: new Date(),
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(loops.id, matchedLoop.id));

          console.log(`[LoopDetection] Updated existing loop: "${parsed.title}" (status: ${newStatus}) for user ${userId}`);
        } else {
          // Insert new loop
          const repCount = currentMemoryIds.length;
          const initialStatus = repCount >= 3 ? 'active' : 'emerging';

          await db.insert(loops).values({
            userId,
            title: parsed.title,
            summary: parsed.summary,
            primaryEmotion: parsed.primaryEmotion,
            loopCategory: parsed.loopCategory,
            avoidanceScore: Number(parsed.avoidanceScore) || 0.0,
            resolutionConfidence: Number(parsed.resolutionConfidence) || 0.5,
            triggerPatterns: parsed.triggerPatterns || [],
            repetitionCount: repCount,
            relatedMemoryIds: currentMemoryIds,
            status: initialStatus,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          });

          console.log(`[LoopDetection] Created new loop: "${parsed.title}" (status: ${initialStatus}) for user ${userId}`);
        }
      } catch (err: any) {
        console.error(`[LoopDetection] Failed to process candidate loop:`, err.message);
      }
    }
  }
}
