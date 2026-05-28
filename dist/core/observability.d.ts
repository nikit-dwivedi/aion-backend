export interface CognitionLogDetails {
    subsystem: 'reinforcement' | 'decay' | 'clustering' | 'contradiction' | 'notification' | 'orchestration' | 'retrieval' | 'extractor' | 'research';
    action: string;
    userId: string;
    inputs?: any;
    outputs?: any;
    reason?: string;
    latencyMs?: number;
    confidenceScore?: number;
    estimatedCost?: number;
    tokenUsage?: number;
}
export declare class CognitionLogger {
    /**
     * Log a structured cognition event to standard output.
     */
    static log(details: CognitionLogDetails): void;
}
//# sourceMappingURL=observability.d.ts.map