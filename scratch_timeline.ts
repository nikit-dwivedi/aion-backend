import { TimelineRepository } from './src/features/timeline/timeline.repository.js';
async function test() {
  const pending = await TimelineRepository.getPendingMemories('005ecc8c-f5ef-4ac1-afb7-6cdc6b9a05a6');
  console.log('pending', pending[0]);
  const recent = await TimelineRepository.getRecentMemories('005ecc8c-f5ef-4ac1-afb7-6cdc6b9a05a6', 5);
  console.log('recent', recent[0]);
  process.exit(0);
}
test();
