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

export class CognitionLogger {
  /**
   * Log a structured cognition event to standard output.
   */
  static log(details: CognitionLogDetails): void {
    const timestamp = new Date().toISOString();
    const logObj = {
      timestamp,
      ...details,
    };
    
    // Log structured JSON for production collectors
    console.log(`[CognitionOS] ${JSON.stringify(logObj)}`);
    
    // Pretty-printed console output for local debugging
    const metaStr = details.reason ? ` | Reason: "${details.reason}"` : '';
    const latencyStr = details.latencyMs !== undefined ? ` | Latency: ${details.latencyMs}ms` : '';
    const confidenceStr = details.confidenceScore !== undefined ? ` | Confidence: ${details.confidenceScore}` : '';
    console.log(
      `🧠 [${details.subsystem.toUpperCase()}] ${details.action} for user ${details.userId}${confidenceStr}${latencyStr}${metaStr}`
    );
  }
}
