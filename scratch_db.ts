import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';
async function test() {
  const result = await db.execute(sql`SELECT id, processing_status, created_at, updated_at FROM events ORDER BY created_at DESC LIMIT 5`);
  console.log(result.rows);
  const nodes = await db.execute(sql`SELECT id, created_at, updated_at FROM nodes ORDER BY created_at DESC LIMIT 5`);
  console.log(nodes.rows);
  process.exit(0);
}
test();
