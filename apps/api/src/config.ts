import { z } from 'zod';

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface ApiConfig {
  host: string;
  port: number;
  appOrigin: string;
  authBaseUrl: string;
  authSecret: string;
  databaseUrl: string;
  environment: 'development' | 'test' | 'production';
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    appOrigin: parsed.APP_ORIGIN,
    authBaseUrl: parsed.BETTER_AUTH_URL,
    authSecret: parsed.BETTER_AUTH_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.NODE_ENV,
  };
}
