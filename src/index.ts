import { app } from './app.js';
import { env } from './config/env.js';
import { startWorker } from './workers/llm_extractor.js';
import { startAgentWorker } from './workers/agent.js';

app.listen(env.PORT, () => {
  console.log(`🚀 AION Backend running on port ${env.PORT}`);
  startWorker();
  startAgentWorker();
});
