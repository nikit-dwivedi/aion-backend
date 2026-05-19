import { db } from './src/db/index.ts';
import { nodes, events, edges } from './src/db/schema.ts';

async function clean() {
  await db.delete(edges);
  await db.delete(nodes);
  await db.delete(events);
  console.log('Cleaned database');
  process.exit(0);
}
clean();
