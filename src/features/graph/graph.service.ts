import { GraphRepository } from './graph.repository.js';

export class GraphService {
  static async getGraph(userId: string) {
    const allNodes = await GraphRepository.getNodes(userId);
    const nodeIds = allNodes.map(n => n.id);
    const allEdges = await GraphRepository.getEdges(nodeIds);

    const graphNodes = allNodes.map(n => ({
      id: n.id,
      type: n.nodeType,
      label: n.content.length > 50 ? n.content.substring(0, 50) + '...' : n.content,
      content: n.content,
    }));

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
