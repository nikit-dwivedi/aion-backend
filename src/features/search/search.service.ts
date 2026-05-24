import { SearchRepository } from './search.repository.js';
import { llm } from '../../services/llm.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/middlewares/error.middleware.js';

export class SearchService {
  static async searchMemories(query: string) {
    if (!query) throw new AppError('Missing query', 400);
    if (!llm.isConfigured) throw new AppError('LLM service is not configured.', 500);

    const queryEmbedding = await llm.embedContent(query);
    const similarNodes = await SearchRepository.findSimilarMemories(queryEmbedding, 5);

    if (similarNodes.length === 0) {
      return { answer: "I couldn't find any relevant memories for that.", context: [] };
    }

    const memoryNodeIds = similarNodes.map(n => n.id);
    const connectedNodesQuery = await SearchRepository.getMemoryConnections(memoryNodeIds);

    const connectionsByMemory: Record<string, string[]> = {};
    for (const row of connectedNodesQuery.rows) {
      const sourceId = row.source_node_id as string;
      const type = row.node_type as string;
      const content = row.content as string;
      
      if (!connectionsByMemory[sourceId]) {
        connectionsByMemory[sourceId] = [];
      }
      connectionsByMemory[sourceId].push(`[${type.toUpperCase()}: ${content}]`);
    }

    const contextStr = similarNodes.map((n, i) => {
      const connections = connectionsByMemory[n.id]?.join(', ') || 'No connected tags.';
      return `Memory ${i + 1}: ${n.content}\nRelated Context: ${connections}`;
    }).join('\n\n');
    
    const prompt = `
      You are AION, the user's external brain and cognitive companion.
      The user asked: "${query}"
      
      Here are the most relevant memories retrieved from their cognitive graph:
      ${contextStr}
      
      Answer their question concisely based ONLY on these memories. 
      If the memories don't contain the answer, say you don't know based on current records.
      Speak directly to the user (e.g., "You thought about...").
    `;

    const answer = await llm.generateContent({ prompt });

    return {
      answer,
      context: similarNodes
    };
  }
}
