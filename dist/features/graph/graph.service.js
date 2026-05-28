import { GraphRepository } from './graph.repository.js';
export class GraphService {
    static async getGraph(userId) {
        const allNodes = await GraphRepository.getNodes(userId);
        const nodeIds = allNodes.map(n => n.id);
        const allEdges = await GraphRepository.getEdges(nodeIds, userId);
        const now = Date.now();
        const graphNodes = allNodes.map(n => {
            const ageDays = (now - new Date(n.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            let heat = Math.max(0.1, Math.exp(-ageDays / 14));
            const edgeCount = allEdges.filter((e) => e.source_node_id === n.id || e.target_node_id === n.id).length;
            if (edgeCount > 2)
                heat = Math.min(1.0, heat + (edgeCount * 0.05));
            let content = n.content;
            let label = content;
            if (n.nodeType === 'insight') {
                try {
                    const parsed = JSON.parse(n.content);
                    if (parsed && typeof parsed === 'object') {
                        label = parsed.title || parsed.body || parsed.content || n.content;
                        content = parsed.body || parsed.content || n.content;
                    }
                }
                catch (e) {
                    const meta = n.metadata;
                    if (meta?.title) {
                        label = meta.title;
                    }
                }
            }
            if (label.length > 50) {
                label = label.substring(0, 50) + '...';
            }
            return {
                id: n.id,
                type: n.nodeType,
                label,
                content,
                heat: parseFloat(heat.toFixed(2)),
            };
        });
        const graphEdges = allEdges.map((e) => ({
            id: e.id,
            source: e.source_node_id,
            target: e.target_node_id,
            relation: e.relation_type,
            weight: e.weight,
        }));
        return { nodes: graphNodes, edges: graphEdges };
    }
}
//# sourceMappingURL=graph.service.js.map