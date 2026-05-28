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
    const migrationsDir = path.join(__dirname, 'migrations');
    console.log(`Reading migrations from: ${migrationsDir}`);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of files) {
      const filepath = path.join(migrationsDir, file);
      console.log(`Running migration: ${file}...`);
      const sqlText = fs.readFileSync(filepath, 'utf8');
      await client.query(sqlText);
    }
    console.log('All migrations completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
