import type { Context, Next } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { AppServices } from '../context';
import type { OwnerRow } from '../services/owner-service';
import { ApiError, Errors } from '../errors';
import { verifySessionToken } from '../security/session';

export interface AppEnv {
  Variables: {
    owner: OwnerRow;
    requestId: string;
  };
}

export const SESSION_COOKIE = 'tally_session';

export function setSessionCookie(c: Context<AppEnv>, services: AppServices, token: string, days: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: services.config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(days * 86_400),
  });
}

export function clearSessionCookie(c: Context<AppEnv>, services: AppServices): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: services.config.secureCookies });
}

/**
 * Session cookies are stateless HMAC tokens. The owner row's `session_epoch` is
 * baked into each token, so changing the PIN invalidates every existing session
 * without needing a session table.
 */
export async function requireAuth(
  c: Context<AppEnv>,
  services: AppServices,
  next: Next,
): Promise<void | Response> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw Errors.unauthorized();
  const payload = verifySessionToken(services.config.appSecret, token);
  if (!payload) {
    clearSessionCookie(c, services);
    throw Errors.unauthorized('Your session expired. Enter your PIN again.');
  }
  const owner = await services.owner.get();
  if (!owner || owner.session_epoch !== payload.epoch) {
    clearSessionCookie(c, services);
    throw Errors.unauthorized('Your session expired. Enter your PIN again.');
  }
  c.set('owner', owner);
  await next();
}

/**
 * Reject cross-site state-changing requests. SameSite=Lax already blocks the
 * usual CSRF vectors; this also guards against browser proxy oddities.
 */
export function originGuard() {
  return async (c: Context<AppEnv>, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if (!c.req.path.startsWith('/api/')) return next();
    const fetchSite = c.req.header('sec-fetch-site');
    if (fetchSite === 'cross-site') {
      return c.json({ error: 'CSRF_INVALID', message: 'Cross-site request rejected.' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin) {
      const host = c.req.header('host');
      let allowed: boolean;
      try {
        allowed = new URL(origin).host === host;
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return c.json({ error: 'CSRF_INVALID', message: 'Request origin is not allowed.' }, 403);
      }
    }
    return next();
  };
}

export function securityHeaders(services: AppServices) {
  return async (c: Context<AppEnv>, next: Next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-App', 'tally');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (services.config.isProduction) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    const isApi = c.req.path.startsWith('/api/');
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(services.config.isProduction ? ['upgrade-insecure-requests'] : []),
    ].join('; ');
    c.header('Content-Security-Policy', csp);
    if (isApi) c.header('Cache-Control', 'no-store, max-age=0');
    await next();
  };
}

export function requestLogger(services: AppServices) {
  return async (c: Context<AppEnv>, next: Next) => {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    c.header('X-Request-Id', requestId);
    c.set('requestId', requestId);
    try {
      await next();
    } finally {
      const duration = Math.round(performance.now() - started);
      services.logger.info(
        {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: duration,
        },
        'request',
      );
    }
  };
}

export function apiErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong.' } };
}
