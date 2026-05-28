export declare class ProjectsRepository {
    static getProjects(userId: string): Promise<{
        id: string;
        content: string;
        createdAt: Date;
    }[]>;
    static getLinkedMemories(projectId: string, userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static getLinkedEntities(projectId: string, userId: string): Promise<import("pg").QueryResult<Record<string, unknown>>>;
    static moveMemoryToProject(memoryId: string, newProjectName: string, userId: string): Promise<void>;
}
//# sourceMappingURL=projects.repository.d.ts.map