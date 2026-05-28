import { startReinforcementScheduler } from './schedulers/reinforcement.scheduler.js';
import { startDecayScheduler } from './schedulers/decay.scheduler.js';
import { startContradictionScheduler } from './schedulers/contradiction.scheduler.js';
import { startEpisodeScheduler } from './schedulers/episode.scheduler.js';

console.log('📅 Starting AION Schedulers...');
startReinforcementScheduler();
startDecayScheduler();
startContradictionScheduler();
startEpisodeScheduler();
