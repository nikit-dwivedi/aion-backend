export class CognitionService {
  /**
   * Calculate node reinforcement values.
   * Increments reinforcement count and builds cognitive momentum.
   */
  static calculateReinforcement(
    currentCount: number,
    currentMomentum: number,
    retrievalCount: number
  ): { reinforcementCount: number; cognitiveMomentum: number } {
    const reinforcementCount = currentCount + retrievalCount;
    const cognitiveMomentum = Math.min(1.0, currentMomentum + retrievalCount * 0.1);
    return { reinforcementCount, cognitiveMomentum };
  }

  /**
   * Calculate decayed weight for an edge based on source node attributes.
   * Emotional anxiety/negativity decays slowly (0.98), actions/goals normally (0.95),
   * research moderately (0.92), and insights decay fast (0.90).
   */
  static calculateEdgeDecay(
    relationType: string,
    sourceNodeType: string,
    sourceNodeSentiment: string | null | undefined,
    currentWeight: number
  ): number {
    // Summarization and ownership edges do not decay
    if (relationType === 'summarizes' || relationType === 'belongs_to') {
      return currentWeight;
    }

    let multiplier = 0.95; // Default decay coefficient

    if (sourceNodeSentiment === 'anxious' || sourceNodeSentiment === 'negative') {
      multiplier = 0.98; // Emotional anxiety decays very slowly
    } else if (sourceNodeType === 'action_item') {
      multiplier = 0.95; // Standard decay for tasks/goals
    } else if (sourceNodeType === 'research') {
      multiplier = 0.92; // Research decays moderately
    } else if (sourceNodeType === 'insight') {
      multiplier = 0.90; // Insights decay quickly
    }

    return currentWeight * multiplier;
  }

  /**
   * Decay general cognitive momentum on a node.
   */
  static calculateNodeDecay(currentMomentum: number): number {
    return Math.max(0.0, currentMomentum - 0.05);
  }

  /**
   * Assess user fatigue, cognitive overload, and determine if standard notifications
   * should be gated or suppressed to preserve focus.
   */
  static evaluateNotificationFatigue(
    recentDispatchedCount: number,
    priority: string
  ): {
    notificationFatigue: number;
    cognitiveOverloadScore: number;
    interruptionScore: number;
    shouldGate: boolean;
  } {
    const isCritical = priority === 'urgent' || priority === 'critical';
    
    // Linear fatigue scaling: 0.25 fatigue per recent notification in a 4-hour window
    const notificationFatigue = recentDispatchedCount * 0.25;
    
    // Cognitive overload score: low (0.2) or high (0.8) based on frequency
    const cognitiveOverloadScore = recentDispatchedCount > 2 ? 0.8 : 0.2;
    
    // Interruption score based on priority tier
    let interruptionScore = 0.3;
    if (priority === 'high' || priority === 'important') {
      interruptionScore = 0.7;
    } else if (isCritical) {
      interruptionScore = 1.0;
    }

    // Gate if overload is high and the event is not critical
    const shouldGate = cognitiveOverloadScore > 0.7 && !isCritical;

    return {
      notificationFatigue,
      cognitiveOverloadScore,
      interruptionScore,
      shouldGate,
    };
  }
}
