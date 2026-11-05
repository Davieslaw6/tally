import { Hono } from 'hono';
import { z } from 'zod';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { Errors } from '../errors';
import { readJson } from '../http/schemas';
import { clearSessionCookie, setSessionCookie } from '../http/security';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../http/security';
import { verifySessionToken, createSessionToken } from '../security/session';
import { toPublicUser } from '../services/owner-service';

const setupSchema = z.object({
  pin: z.string().regex(/^\d{4,12}$/, 'Use a PIN of 4 to 12 digits.'),
  displayName: z.string().max(80).optional().nullable(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  locale: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
});

const loginSchema = z.object({
  pin: z.string().min(1).max(32),
});

const changePinSchema = z.object({
  currentPin: z.string().min(1).max(32),
  newPin: z.string().regex(/^\d{4,12}$/, 'Use a PIN of 4 to 12 digits.'),
});

/** Issue a session for the current owner row and set the cookie. */
function startSession(c: Parameters<typeof setSessionCookie>[0], services: AppServices, epoch: number): void {
  const token = createSessionToken(services.config.appSecret, epoch, services.config.sessionDays);
  setSessionCookie(c, services, token, services.config.sessionDays);
}

export function createAuthRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/status', async (c) => {
    const owner = await services.owner.get();
    let authenticated = false;
    if (owner) {
      const token = getCookie(c, SESSION_COOKIE);
      const payload = token ? verifySessionToken(services.config.appSecret, token) : null;
      authenticated = Boolean(payload && payload.epoch === owner.session_epoch);
    }
    return c.json({ configured: Boolean(owner), authenticated });
  });

  router.post('/setup', async (c) => {
    const input = await readJson(c, setupSchema);
    const result = await services.owner.setup(input);
    startSession(c, services, result.owner.session_epoch);
    return c.json(
      {
        user: toPublicUser(result.owner),
        settings: result.settings,
      },
      201,
    );
  });

  router.post('/login', async (c) => {
    const input = await readJson(c, loginSchema);
    const result = await services.owner.verify(input.pin);
    if (!result.ok) {
      if (result.reason === 'locked') {
        c.header('Retry-After', String(result.retryAfterSec ?? 300));
        throw Errors.tooMany(
          `Too many incorrect PINs. Try again in ${Math.ceil((result.retryAfterSec ?? 300) / 60)} minute(s).`,
        );
      }
      throw Errors.unauthorized('That PIN did not match.');
    }
    startSession(c, services, result.owner.session_epoch);
    return c.json({
      user: toPublicUser(result.owner),
      settings: await services.settings.get(),
    });
  });

  router.post('/logout', async (c) => {
    clearSessionCookie(c, services);
    return c.json({ ok: true });
  });

  router.post('/change-pin', async (c) => {
    const input = await readJson(c, changePinSchema);
    const owner = await services.owner.changePin(input.currentPin, input.newPin);
    // Changing the PIN bumps the session epoch, so refresh this browser's cookie.
    startSession(c, services, owner.session_epoch);
    return c.json({ ok: true });
  });

  return router;
}
