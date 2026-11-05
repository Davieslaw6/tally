import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PIN, apiRequest, createTestContext, jsonRequest, readJson, setupOwner, type TestContext } from './helpers';

interface Fixture {
  ctx: TestContext;
  sessionToken: string;
}

let fixture: Fixture;

beforeAll(async () => {
  const ctx = await createTestContext();
  const owner = await setupOwner(ctx);
  fixture = { ctx, sessionToken: owner.sessionToken };
});

afterAll(async () => {
  await fixture.ctx.cleanup();
});

describe('PIN authentication', () => {
  it('reports a fresh ledger as unconfigured and requires setup', async () => {
    const ctx = await createTestContext();
    try {
      const status = await apiRequest(ctx.app, null, '/api/auth/status');
      expect(status.status).toBe(200);
      expect(await readJson(status)).toEqual({ configured: false, authenticated: false });

      const me = await apiRequest(ctx.app, null, '/api/me');
      expect(me.status).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });

  it('sets up the owner once and issues a session cookie', async () => {
    const ctx = await createTestContext();
    try {
      const setup = await apiRequest(
        ctx.app,
        null,
        '/api/auth/setup',
        jsonRequest({ pin: '135790', displayName: 'Avery', currency: 'NGN', locale: 'en-NG', timezone: 'Africa/Lagos' }),
      );
      expect(setup.status).toBe(201);
      const body = await readJson<{ user: { currency: string; displayName: string }; settings: unknown }>(setup);
      expect(body.user).toMatchObject({ currency: 'NGN', displayName: 'Avery' });
      const cookie = setup.headers.get('set-cookie') ?? '';
      expect(cookie).toContain('tally_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');

      const token = cookie.slice(cookie.indexOf('tally_session=') + 'tally_session='.length, cookie.indexOf(';'));
      const me = await apiRequest(ctx.app, token, '/api/me');
      expect(me.status).toBe(200);
      expect((await readJson<{ user: { currency: string } }>(me)).user.currency).toBe('NGN');

      const second = await apiRequest(ctx.app, null, '/api/auth/setup', jsonRequest({ pin: '246810' }));
      expect(second.status).toBe(409);
    } finally {
      await ctx.cleanup();
    }
  });

  it('logs in with the correct PIN and rejects a wrong one', async () => {
    const good = await apiRequest(fixture.ctx.app, null, '/api/auth/login', jsonRequest({ pin: TEST_PIN }));
    expect(good.status).toBe(200);
    expect(good.headers.get('set-cookie')).toContain('tally_session=');

    const bad = await apiRequest(fixture.ctx.app, null, '/api/auth/login', jsonRequest({ pin: '000000' }));
    expect(bad.status).toBe(401);
    expect((await readJson<{ message: string }>(bad)).message).toBe('That PIN did not match.');
  });

  it('locks the PIN after five wrong attempts', async () => {
    const ctx = await createTestContext();
    try {
      await setupOwner(ctx, { pin: '112233' });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await apiRequest(ctx.app, null, '/api/auth/login', jsonRequest({ pin: '999999' }));
        expect(response.status).toBe(attempt === 4 ? 429 : 401);
      }
      const locked = await apiRequest(ctx.app, null, '/api/auth/login', jsonRequest({ pin: '112233' }));
      expect(locked.status).toBe(429);
      expect(locked.headers.get('retry-after')).toBe('300');

      const owner = await ctx.services.owner.get();
      expect(owner?.failed_attempts).toBe(0);
      expect(owner?.locked_until).toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  it('changes the PIN, signs out old sessions, and keeps the current browser signed in', async () => {
    const ctx = await createTestContext();
    try {
      const owner = await setupOwner(ctx, { pin: '445566' });
      const change = await apiRequest(
        ctx.app,
        owner.sessionToken,
        '/api/auth/change-pin',
        jsonRequest({ currentPin: '445566', newPin: '778899' }),
      );
      expect(change.status).toBe(200);
      const cookie = change.headers.get('set-cookie') ?? '';
      const fresh = cookie.slice(cookie.indexOf('tally_session=') + 'tally_session='.length, cookie.indexOf(';'));
      expect(fresh).not.toBe(owner.sessionToken);

      const oldSession = await apiRequest(ctx.app, owner.sessionToken, '/api/me');
      expect(oldSession.status).toBe(401);

      const freshSession = await apiRequest(ctx.app, fresh, '/api/me');
      expect(freshSession.status).toBe(200);

      const oldPin = await apiRequest(ctx.app, null, '/api/auth/login', jsonRequest({ pin: '445566' }));
      expect(oldPin.status).toBe(401);
      const newPin = await apiRequest(ctx.app, null, '/api/auth/login', jsonRequest({ pin: '778899' }));
      expect(newPin.status).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });

  it('clears the session on logout', async () => {
    const logout = await apiRequest(fixture.ctx.app, fixture.sessionToken, '/api/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('tally_session=');
  });

  it('rejects a cross-site state-changing request', async () => {
    const response = await apiRequest(fixture.ctx.app, fixture.sessionToken, '/api/accounts', {
      ...jsonRequest({ name: 'Injected', type: 'cash' }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect((await readJson<{ error: string }>(response)).error).toBe('CSRF_INVALID');
  });
});

describe('public API surface', () => {
  it('serves health and meta without a session', async () => {
    const health = await apiRequest(fixture.ctx.app, null, '/api/health');
    expect(health.status).toBe(200);
    expect((await readJson<{ status: string }>(health)).status).toBe('ok');

    const meta = await apiRequest(fixture.ctx.app, null, '/api/meta');
    expect(meta.status).toBe(200);
    const body = await readJson<{ primaryCurrencies: string[] }>(meta);
    expect(body.primaryCurrencies).toEqual(['NGN', 'USD', 'EUR', 'CAD', 'GBP']);
  });
});
