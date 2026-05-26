import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const connectionString = process.env.DATABASE_URL || 'postgres://aion_user:aion_password@localhost:5432/aion_db';
  console.log(`Connecting to database at ${connectionString.split('@')[1]}...`);
  
  const client = new Client({ connectionString });
  await client.connect();
  
  try {
    const migrationPath = path.join(__dirname, 'migrations', '001_production_hardening.sql');
    console.log(`Reading migration from: ${migrationPath}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
