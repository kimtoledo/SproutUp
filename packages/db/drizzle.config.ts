import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// db commands run with a cwd of packages/db, so load the monorepo root .env
// explicitly rather than relying on dotenv's cwd lookup.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle commands');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
