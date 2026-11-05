import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  appVersion: string;
  appSecret: string;
  databaseUrl: string | null;
  pgliteDir: string;
  databasePoolMax: number;
  databaseConnectTimeoutMs: number;
  clientDist: string;
  secureCookies: boolean;
  sessionDays: number;
  logLevel: string;
  maxTransactions: number;
}

const DEV_SECRET = 'tally-development-only-secret-change-before-production-0001';

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  try {
    process.loadEnvFile?.();
  } catch {
    // .env is optional.
  }

  const env = (process.env.NODE_ENV as AppConfig['env']) || 'development';
  const isProduction = env === 'production';
  const dataDir = path.resolve(process.env.TALLY_DATA_DIR ?? './tally-data');
  const databaseUrl = process.env.DATABASE_URL?.trim() || null;

  if (isProduction && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production. Connect a Neon PostgreSQL database.');
  }

  let appSecret = process.env.APP_SECRET ?? '';
  if (!appSecret) {
    if (isProduction) {
      throw new Error('APP_SECRET is required in production (at least 32 random characters).');
    }
    appSecret = DEV_SECRET;
  }
  if (isProduction && appSecret.length < 32) {
    throw new Error('APP_SECRET must be at least 32 characters in production.');
  }

  const pgliteDirRaw = process.env.TALLY_PGLITE_DIR?.trim() || path.join(dataDir, 'pglite');
  const pgliteDir = pgliteDirRaw === 'memory://' ? pgliteDirRaw : path.resolve(pgliteDirRaw);

  const config: AppConfig = {
    env,
    isProduction,
    port: integerEnv('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    appVersion: process.env.npm_package_version ?? '2.0.0',
    appSecret,
    databaseUrl,
    pgliteDir,
    databasePoolMax: integerEnv('DATABASE_POOL_MAX', 5),
    databaseConnectTimeoutMs: integerEnv('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    clientDist: path.resolve(process.env.TALLY_CLIENT_DIST ?? './dist/client'),
    secureCookies: booleanEnv('COOKIE_SECURE', isProduction),
    sessionDays: Math.max(1, integerEnv('SESSION_DAYS', 30)),
    logLevel: process.env.LOG_LEVEL ?? (env === 'test' ? 'silent' : 'info'),
    maxTransactions: integerEnv('TALLY_MAX_TRANSACTIONS', 500_000),
  };

  if (config.isProduction && (appSecret === DEV_SECRET || appSecret.startsWith('replace-me'))) {
    throw new Error('Refusing to start production with a placeholder APP_SECRET. Generate a random secret.');
  }

  if (!config.databaseUrl && config.pgliteDir !== 'memory://') {
    fs.mkdirSync(path.dirname(config.pgliteDir), { recursive: true, mode: 0o700 });
  }

  return { ...config, ...overrides };
}

export function generateSecret(): string {
  return randomBytes(48).toString('base64url');
}
