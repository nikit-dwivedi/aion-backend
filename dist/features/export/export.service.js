import { ExportRepository } from './export.repository.js';
export class ExportService {
    static async getExportData(userId) {
        const allNodes = await ExportRepository.getAllNodes(userId);
        const nodeIds = allNodes.map(n => n.id);
        const allEdges = await ExportRepository.getAllEdges(nodeIds);
        return {
            exportedAt: new Date().toISOString(),
            nodes: allNodes.map(n => ({
                id: n.id,
                type: n.nodeType,
                content: n.content,
                metadata: n.metadata,
                createdAt: n.createdAt,
            })),
            edges: allEdges.map((e) => ({
                source: e.source_node_id,
                target: e.target_node_id,
                relation: e.relation_type,
                weight: e.weight,
            })),
            stats: {
                totalNodes: allNodes.length,
                totalEdges: allEdges.length,
                memories: allNodes.filter(n => n.nodeType === 'memory').length,
                projects: allNodes.filter(n => n.nodeType === 'project').length,
                entities: allNodes.filter(n => n.nodeType === 'entity').length,
            },
        };
    }
}
//# sourceMappingURL=export.service.js.map