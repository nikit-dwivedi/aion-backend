import { TimelineRepository } from './timeline.repository.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class TimelineService {
  static async getTimeline(userId: string) {
    const memories = await TimelineRepository.getRecentMemories(userId, 50);

    const enriched = await Promise.all(memories.map(async (mem) => {
      if (mem.nodeType === 'insight') {
        let content = mem.content;
        let title = 'Cognitive Insight';
        let recommendation = '';
        let insightType = 'behavioral';
        let strength = 1.0;
        let relatedEntityOrProject = null;

        // Try parsing content in case it is serialized JSON (from CopilotService)
        try {
          const parsed = JSON.parse(mem.content);
          if (parsed && typeof parsed === 'object') {
            title = parsed.title || title;
            content = parsed.body || parsed.content || content;
            insightType = parsed.type || parsed.insightType || insightType;
            recommendation = parsed.recommendation || recommendation;
            strength = parsed.strength !== undefined ? Number(parsed.strength) : strength;
            relatedEntityOrProject = parsed.relatedEntityOrProject || relatedEntityOrProject;
          }
        } catch (e) {
          // Content is not JSON, it's a plain string from InsightEngine
          const meta = mem.metadata as any;
          title = meta?.title || title;
          recommendation = meta?.recommendation || recommendation;
          insightType = meta?.type || insightType;
          strength = meta?.strength || strength;
          relatedEntityOrProject = meta?.relatedEntityOrProject || null;
        }

        return {
          ...mem,
          content,
          title,
          recommendation,
          insightType,
          strength,
          relatedEntityOrProject,
          project: null,
          rawContent: null,
          sentiment: 'neutral',
          moodScore: 5
        };
      }

      const projectName = await TimelineRepository.getProjectForMemory(mem.id, userId);
      const meta = mem.metadata as any;
      return {
        ...mem,
        project: projectName,
        rawContent: meta?.rawContent || null,
        sentiment: meta?.sentiment || 'neutral',
        moodScore: meta?.moodScore || 5,
      };
    }));

    return enriched;
  }

  static async getResurfaced(userId: string) {
    const raw = await TimelineRepository.getResurfacedMemories(userId);
    return raw.map((r: any) => ({
      id: r.id,
      nodeType: 'memory',
      content: r.content,
      createdAt: r.created_at,
      daysAgo: Math.round((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));
  }

  static async getMemoryDetail(userId: string, memoryId: string) {
    if (!memoryId) throw new AppError('Missing memory id', 400);

    const memory = await TimelineRepository.getMemoryById(userId, memoryId);
    if (!memory) throw new AppError('Memory not found', 404);

    const connections = await TimelineRepository.getMemoryConnections(memoryId, userId);
    const entities = connections.filter(r => r.node_type === 'entity').map(r => r.content);
    const project = connections.find(r => r.node_type === 'project')?.content || null;
    const rawThoughtId = connections.find(r => r.node_type === 'raw_thought')?.id || null;

    let relatedMemories: any[] = [];
    if (memory.embedding) {
      relatedMemories = await TimelineRepository.getSimilarMemories(userId, memoryId, memory.embedding);
    }

    let content = memory.content;
    let title = undefined;
    let insightType = undefined;
    let recommendation = undefined;
    let strength = undefined;
    let relatedEntityOrProject = null;

    if (memory.nodeType === 'insight') {
      title = 'Cognitive Insight';
      insightType = 'behavioral';
      strength = 1.0;
      recommendation = '';

      try {
        const parsed = JSON.parse(memory.content);
        if (parsed && typeof parsed === 'object') {
          title = parsed.title || title;
          content = parsed.body || parsed.content || content;
          insightType = parsed.type || parsed.insightType || insightType;
          recommendation = parsed.recommendation || recommendation;
          strength = parsed.strength !== undefined ? Number(parsed.strength) : strength;
          relatedEntityOrProject = parsed.relatedEntityOrProject || relatedEntityOrProject;
        }
      } catch (e) {
        const meta = memory.metadata as any;
        title = meta?.title || title;
        recommendation = meta?.recommendation || recommendation;
        insightType = meta?.type || insightType;
        strength = meta?.strength || strength;
        relatedEntityOrProject = meta?.relatedEntityOrProject || null;
      }
    }

    const meta = memory.metadata as any;
    return {
      memory: {
        id: memory.id,
        nodeType: memory.nodeType,
        content,
        title,
        insightType,
        recommendation,
        strength,
        relatedEntityOrProject,
        rawContent: meta?.rawContent || content,
        sentiment: meta?.sentiment || 'neutral',
        moodScore: meta?.moodScore || 5,
        rawThoughtId,
        project,
        entities,
        createdAt: memory.createdAt,
        relatedMemories,
      }
    };
  }

  static async deleteMemory(memoryId: string, userId: string) {
    if (!memoryId) throw new AppError('Missing memory id', 400);
    await TimelineRepository.deleteMemory(memoryId, userId);
  }
}
