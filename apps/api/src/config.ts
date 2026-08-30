import { z } from 'zod';

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  APP_ORIGINS: z.string().min(1).optional(),
  AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // How much of `X-Forwarded-For` to trust when deriving the client IP used for
  // rate-limit bucketing and audit evidence. `false` (default) trusts none —
  // safe when the API is reached directly. Set to `true` only when a trusted
  // proxy always terminates client connections; prefer a hop count (`1`) or a
  // comma-separated proxy IP/CIDR allowlist.
  API_TRUST_PROXY: z.string().min(1).optional(),
  // Development-only outbox for password-reset/email-verification links; see
  // `notifications/email-delivery.ts`. Unused in production, which fails
  // closed until an approved transactional-email provider is wired.
  EMAIL_OUTBOX_DIR: z.string().min(1).default('.data/email-outbox'),
  // Development-only private-document root; see `storage/select-file-storage.ts`.
  // Unused in production, which fails closed until an approved object-storage
  // adapter is wired.
  DOCUMENT_STORAGE_DIR: z.string().min(1).default('.data/documents'),
});

export type TrustProxyConfig = boolean | number | string[];

function parseTrustProxy(value: string | undefined): TrustProxyConfig {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false' || normalized === '') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface ApiConfig {
  host: string;
  port: number;
  appOrigin: string;
  appOrigins: string[];
  authCookieDomain?: string;
  authBaseUrl: string;
  authSecret: string;
  databaseUrl: string;
  environment: 'development' | 'test' | 'production';
  trustProxy: TrustProxyConfig;
  emailOutboxDir: string;
  documentStorageDir: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.parse(environment);
  const configuredOrigins = parsed.APP_ORIGINS
    ? parsed.APP_ORIGINS.split(',').map((origin) => z.url().parse(origin.trim()))
    : [];
  const appOrigins = [...new Set([parsed.APP_ORIGIN, ...configuredOrigins])];

  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    appOrigin: parsed.APP_ORIGIN,
    appOrigins,
    authCookieDomain: parsed.AUTH_COOKIE_DOMAIN,
    authBaseUrl: parsed.BETTER_AUTH_URL,
    authSecret: parsed.BETTER_AUTH_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.NODE_ENV,
    trustProxy: parseTrustProxy(parsed.API_TRUST_PROXY),
    emailOutboxDir: parsed.EMAIL_OUTBOX_DIR,
    documentStorageDir: parsed.DOCUMENT_STORAGE_DIR,
  };
}
