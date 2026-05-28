import { app } from './app.js';
import { env } from './config/env.js';
import { startWorker } from './workers/llm_extractor.js';
import { startAgentWorker } from './workers/agent.js';
import { startOrchestrationWorker } from './workers/cognitive_orchestrator.js';
import { startInsightWorker } from './workers/insight_worker.js';
import { startMemoryEvolutionWorker } from './workers/memory_evolution_worker.js';
import { startNotificationWorker } from './workers/notification_worker.js';

app.listen(env.PORT, () => {
  console.log(`🚀 AION Backend running on port ${env.PORT}`);
  startWorker();
  startAgentWorker();
  startOrchestrationWorker();
  startInsightWorker();
  startMemoryEvolutionWorker();
  startNotificationWorker();
});
