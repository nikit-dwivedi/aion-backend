import { env } from './config/env.js';
import { startWorker } from './workers/llm_extractor.js';
import { startAgentWorker } from './workers/agent.js';
import { startOrchestrationWorker } from './workers/cognitive_orchestrator.js';
import { startInsightWorker } from './workers/insight_worker.js';
import { startNotificationWorker } from './workers/notification_worker.js';
// Isolated background workers
import { startReinforcementWorker } from './workers/reinforcement_worker.js';
import { startDecayWorker } from './workers/decay_worker.js';
import { startContradictionWorker } from './workers/contradiction_worker.js';
import { startEpisodeWorker } from './workers/episode_worker.js';
console.log('🤖 Starting AION Workers...');
startWorker();
startAgentWorker();
startOrchestrationWorker();
startInsightWorker();
startNotificationWorker();
startReinforcementWorker();
startDecayWorker();
startContradictionWorker();
startEpisodeWorker();
//# sourceMappingURL=worker.js.map