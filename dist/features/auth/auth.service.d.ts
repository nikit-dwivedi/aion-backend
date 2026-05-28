export declare class AuthService {
    static register(email: string, password: string, timezone?: string): Promise<{
        token: string;
        userId: string;
    }>;
    static login(email: string, password: string, timezone?: string): Promise<{
        token: string;
        userId: string;
    }>;
    static getProfile(userId: string): Promise<{
        id: string;
        email: string;
        timezone: string;
        tier: string;
        llmUsage: number;
        createdAt: Date;
    }>;
    static upgradeToPro(userId: string): Promise<{
        id: string;
        tier: string;
    }>;
}
//# sourceMappingURL=auth.service.d.ts.map