export declare class ProjectsService {
    static getProjects(userId: string): Promise<{
        memoryCount: number;
        memories: Record<string, unknown>[];
        entities: any[];
        id: string;
        content: string;
        createdAt: Date;
    }[]>;
    static moveMemoryToProject(memoryId: string, newProjectName: string, userId: string): Promise<void>;
}
//# sourceMappingURL=projects.service.d.ts.map