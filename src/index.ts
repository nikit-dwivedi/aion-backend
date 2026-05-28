import { app } from './app.js';
import { env } from './config/env.js';
import { startWorker } from './workers/llm_extractor.js';
import { startAgentWorker } from './workers/agent.js';
import { startOrchestrationWorker } from './workers/cognitive_orchestrator.js';
import { startInsightWorker } from './workers/insight_worker.js';
import { startNotificationWorker } from './workers/notification_worker.js';

// Import new schedulers
import { startReinforcementScheduler } from './schedulers/reinforcement.scheduler.js';
import { startDecayScheduler } from './schedulers/decay.scheduler.js';
import { startContradictionScheduler } from './schedulers/contradiction.scheduler.js';
import { startEpisodeScheduler } from './schedulers/episode.scheduler.js';

// Import new isolated workers
import { startReinforcementWorker } from './workers/reinforcement_worker.js';
import { startDecayWorker } from './workers/decay_worker.js';
import { startContradictionWorker } from './workers/contradiction_worker.js';
import { startEpisodeWorker } from './workers/episode_worker.js';

app.listen(env.PORT, () => {
  console.log(`🚀 AION Backend running on port ${env.PORT}`);
  
  // Start queue handlers & reactive worker subsystems
  startWorker();
  startAgentWorker();
  startOrchestrationWorker();
  startInsightWorker();
  startNotificationWorker();

  // Start new isolated workers
  startReinforcementWorker();
  startDecayWorker();
  startContradictionWorker();
  startEpisodeWorker();

  // Start schedulers enqueuing evolution tasks
  startReinforcementScheduler();
  startDecayScheduler();
  startContradictionScheduler();
  startEpisodeScheduler();
});
