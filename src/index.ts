import { app } from './app.js';
import { env } from './config/env.js';
import { startWorker } from './workers/llm_extractor.js';
import { startAgentWorker } from './workers/agent.js';
import { startPlannerWorker } from './workers/planner.js';
import { startInsightWorker } from './workers/insight_worker.js';

app.listen(env.PORT, () => {
  console.log(`🚀 AION Backend running on port ${env.PORT}`);
  startWorker();
  startAgentWorker();
  startPlannerWorker();
  startInsightWorker();
});
