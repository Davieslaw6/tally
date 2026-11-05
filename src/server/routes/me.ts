import { Hono } from 'hono';
import { z } from 'zod';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { readJson } from '../http/schemas';
import { toPublicUser } from '../services/owner-service';

const settingsPatch = z.object({
  theme: z.enum(['dark', 'light', 'contrast']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  navCollapsed: z.boolean().optional(),
  chartView: z.enum(['bar', 'area', 'line']).optional(),
  chartRange: z.enum(['1M', '3M', '6M', '1Y', 'YTD', 'custom']).optional(),
  onboardingCompleted: z.boolean().optional(),
});

const profilePatch = z.object({
  displayName: z.string().max(80).optional().nullable(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  locale: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
});

export function createMeRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/me', async (c) => {
    return c.json({
      user: toPublicUser(c.var.owner),
      settings: await services.settings.get(),
    });
  });

  router.get('/settings', async (c) => {
    return c.json({ settings: await services.settings.get() });
  });

  router.patch('/settings', async (c) => {
    const input = await readJson(c, settingsPatch);
    return c.json({ settings: await services.settings.update(input) });
  });

  router.patch('/profile', async (c) => {
    const input = await readJson(c, profilePatch);
    const owner = await services.owner.updateProfile(input);
    return c.json({ user: toPublicUser(owner), settings: await services.settings.get() });
  });

  return router;
}
