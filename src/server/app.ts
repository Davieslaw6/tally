import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { createServices, type AppServices } from './context';
import type { AppConfig } from './config';
import type { AppEnv } from './http/security';
import { originGuard, requestLogger, requireAuth, securityHeaders } from './http/security';
import { createAuthRoutes } from './routes/auth';
import { createAccountRoutes } from './routes/accounts';
import { createTransactionRoutes } from './routes/transactions';
import { createMeRoutes } from './routes/me';
import { createReportRoutes } from './routes/reports';
import { createPlanningRoutes } from './routes/planning';
import { ApiError } from './errors';
import { CURRENCY_CODES, PRIMARY_CURRENCY_CODES } from '../shared/currencies';

export interface TallyApp {
  app: Hono<AppEnv>;
  services: AppServices;
}

const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/meta',
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function safeStaticPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const resolved = path.resolve(root, `.${decoded}`);
  if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) return null;
  return resolved;
}

async function serveClient(services: AppServices, c: Context<AppEnv>): Promise<Response> {
  const pathname = new URL(c.req.url).pathname;
  const dist = services.config.clientDist;
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;padding:3rem;background:#111;color:#eee"><h1>TALLY API is running</h1><p>The frontend has not been built for this process. Run <code>npm run build</code>, or use the Vite dev server.</p></body></html>`,
      503,
    );
  }
  if (pathname !== '/' && pathname !== '/index.html') {
    const file = safeStaticPath(dist, pathname);
    if (file) {
      try {
        const stat = await fs.promises.stat(file);
        if (stat.isFile()) {
          const ext = path.extname(file).toLowerCase();
          c.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
          c.header(
            'Cache-Control',
            pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
          );
          return c.body(await fs.promises.readFile(file));
        }
      } catch {
        // fall through to SPA index
      }
    }
  }
  c.header('Cache-Control', 'no-cache');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(await fs.promises.readFile(index));
}

export async function createApp(configOrServices: AppConfig | AppServices): Promise<TallyApp> {
  const isServices = (value: AppConfig | AppServices): value is AppServices =>
    'client' in value && 'owner' in value;
  const services = isServices(configOrServices) ? configOrServices : await createServices(configOrServices);
  const app = new Hono<AppEnv>();

  app.use('*', requestLogger(services));
  app.use('*', securityHeaders(services));
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (ctx) =>
        ctx.json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request exceeds the 1 MB limit.' }, 413),
    }),
  );
  app.use('/api/*', originGuard());

  app.get('/api/health', async (c) => {
    try {
      await services.client.prepare('SELECT 1').get();
      return c.json({
        status: 'ok',
        app: 'tally',
        version: services.config.appVersion,
        time: new Date().toISOString(),
      });
    } catch {
      return c.json({ status: 'degraded', app: 'tally' }, 503);
    }
  });

  app.get('/api/meta', (c) =>
    c.json({
      name: 'TALLY',
      tagline: 'Every dollar, accounted for.',
      version: services.config.appVersion,
      currencies: CURRENCY_CODES,
      primaryCurrencies: PRIMARY_CURRENCY_CODES,
    }),
  );

  // Authenticate every API route except the deliberate public set. Applying this
  // before route dispatch means a new endpoint is protected by default.
  app.use('/api/*', async (c, next) => {
    const key = `${c.req.method.toUpperCase()} ${c.req.path}`;
    if (PUBLIC_ROUTES.has(key)) return next();
    return requireAuth(c, services, next);
  });

  app.route('/api/auth', createAuthRoutes(services));
  app.route('/api', createAccountRoutes(services));
  app.route('/api', createTransactionRoutes(services));
  app.route('/api', createMeRoutes(services));
  app.route('/api', createReportRoutes(services));
  app.route('/api', createPlanningRoutes(services));

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'NOT_FOUND', message: 'API route not found.' }, 404);
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.json({ error: 'NOT_FOUND', message: 'Not found.' }, 404);
    }
    return serveClient(services, c);
  });

  app.onError((error, c) => {
    const isApi = c.req.path.startsWith('/api/');
    if (error instanceof ApiError) {
      return c.json(
        {
          error: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
        error.status as 400,
      );
    }
    if (error instanceof HTTPException) {
      return c.json({ error: 'HTTP_ERROR', message: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: 'BAD_REQUEST', message: 'Request body could not be parsed.' }, 400);
    }
    services.logger.error({ err: error, path: c.req.path, requestId: c.var.requestId }, 'unhandled request error');
    if (!isApi) return c.text('Something went wrong.', 500);
    return c.json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' }, 500);
  });

  app.get('/', (c) => serveClient(services, c));
  app.get('/index.html', (c) => serveClient(services, c));
  app.get('/assets/*', (c) => serveClient(services, c));
  app.get('/favicon.svg', (c) => serveClient(services, c));

  return { app, services };
}
