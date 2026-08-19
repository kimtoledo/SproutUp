import 'dotenv/config';
import { createDatabase } from './database.js';

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
