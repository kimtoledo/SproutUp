import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createDatabase } from './database.js';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to check database readiness');
}

const database = createDatabase(databaseUrl);
try {
  await database.check();
} finally {
  await database.close();
}
