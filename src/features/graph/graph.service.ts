import { GraphRepository } from './graph.repository.js';

export class GraphService {
  static async getGraph(userId: string) {
    const allNodes = await GraphRepository.getNodes(userId);
    const nodeIds = allNodes.map(n => n.id);
    const allEdges = await GraphRepository.getEdges(nodeIds);

    const now = Date.now();
    const graphNodes = allNodes.map(n => {
      const ageDays = (now - new Date(n.createdAt!).getTime()) / (1000 * 60 * 60 * 24);
      let heat = Math.max(0.1, Math.exp(-ageDays / 14));
      const edgeCount = allEdges.filter((e: any) => e.source_node_id === n.id || e.target_node_id === n.id).length;
      if (edgeCount > 2) heat = Math.min(1.0, heat + (edgeCount * 0.05));

      return {
        id: n.id,
        type: n.nodeType,
        label: n.content.length > 50 ? n.content.substring(0, 50) + '...' : n.content,
        content: n.content,
        heat: parseFloat(heat.toFixed(2)),
      };
    });

    const graphEdges = allEdges.map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      relation: e.relation_type,
      weight: e.weight,
    }));

    return { nodes: graphNodes, edges: graphEdges };
  }
}
