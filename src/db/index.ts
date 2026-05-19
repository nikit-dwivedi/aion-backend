import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

const pool = new Pool({
  connectionString: 'postgres://aion_user:aion_password@localhost:5432/aion_db',
});

export const db = drizzle(pool, { schema });
