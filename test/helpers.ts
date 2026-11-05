import type { Hono } from 'hono';
import { loadConfig } from '../src/server/config';
import { createServices, type AppServices } from '../src/server/context';
import { createApp } from '../src/server/app';
import type { AppEnv } from '../src/server/http/security';
import { createSessionToken } from '../src/server/security/session';
import type { PublicUser } from '../src/shared/types';

export const TEST_PIN = '482915';
export const TEST_SECRET = 'tally-test-app-secret-0123456789abcdef';

export interface TestContext {
  app: Hono<AppEnv>;
  services: AppServices;
  cleanup: () => Promise<void>;
}

/** A fresh, migrated in-memory PGlite database for each test file. */
export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig({
    env: 'test',
    isProduction: false,
    databaseUrl: null,
    pgliteDir: 'memory://',
    appSecret: TEST_SECRET,
    secureCookies: false,
    logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
  });
  const services = await createServices(config);
  const { app } = await createApp(services);
  return {
    app,
    services,
    cleanup: async () => {
      await services.close();
    },
  };
}

export interface OwnerFixture {
  user: PublicUser;
  sessionToken: string;
}

/** Create the single owner and mint a valid session cookie token. */
export async function setupOwner(
  ctx: TestContext,
  options: { pin?: string; currency?: string; displayName?: string; locale?: string; timezone?: string } = {},
): Promise<OwnerFixture> {
  const result = await ctx.services.owner.setup({
    pin: options.pin ?? TEST_PIN,
    displayName: options.displayName ?? 'Test Owner',
    currency: options.currency ?? 'USD',
    locale: options.locale ?? 'en-US',
    timezone: options.timezone ?? 'UTC',
  });
  return {
    user: {
      id: result.owner.id,
      displayName: result.owner.display_name,
      currency: result.owner.currency,
      locale: result.owner.locale,
      timezone: result.owner.timezone,
      createdAt: result.owner.created_at,
    },
    sessionToken: createSessionToken(ctx.services.config.appSecret, result.owner.session_epoch, 30),
  };
}

export function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Call the API with a session token, exercising the cookie auth path. */
export function apiRequest(
  app: Hono<AppEnv>,
  sessionToken: string | null,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set('cookie', `tally_session=${sessionToken}`);
  return Promise.resolve(app.request(pathname, { ...init, headers }));
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
