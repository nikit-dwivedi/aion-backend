export declare class CognitionService {
    /**
     * Calculate node reinforcement values.
     * Increments reinforcement count and builds cognitive momentum.
     */
    static calculateReinforcement(currentCount: number, currentMomentum: number, retrievalCount: number): {
        reinforcementCount: number;
        cognitiveMomentum: number;
    };
    /**
     * Calculate decayed weight for an edge based on source node attributes.
     * Emotional anxiety/negativity decays slowly (0.98), actions/goals normally (0.95),
     * research moderately (0.92), and insights decay fast (0.90).
     */
    static calculateEdgeDecay(relationType: string, sourceNodeType: string, sourceNodeSentiment: string | null | undefined, currentWeight: number): number;
    /**
     * Decay general cognitive momentum on a node.
     */
    static calculateNodeDecay(currentMomentum: number): number;
    /**
     * Assess user fatigue, cognitive overload, and determine if standard notifications
     * should be gated or suppressed to preserve focus.
     */
    static evaluateNotificationFatigue(recentDispatchedCount: number, priority: string): {
        notificationFatigue: number;
        cognitiveOverloadScore: number;
        interruptionScore: number;
        shouldGate: boolean;
    };
}
//# sourceMappingURL=cognition.service.d.ts.map