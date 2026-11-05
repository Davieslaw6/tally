import { Hono } from 'hono';
import { z } from 'zod';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { readJson } from '../http/schemas';

const accountCreate = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['checking', 'savings', 'credit', 'cash', 'investment']),
  institution: z.string().max(100).optional().nullable(),
  openingBalanceCents: z.number().int().safe().optional(),
  color: z.string().max(120).optional(),
});

const accountUpdate = accountCreate.partial().extend({
  archived: z.boolean().optional(),
});

const categoryCreate = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(['expense', 'income']),
  color: z.string().max(120).optional(),
  icon: z.string().max(32).optional(),
});

const categoryUpdate = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().max(120).optional(),
  icon: z.string().max(32).optional(),
  archived: z.boolean().optional(),
});

export function createAccountRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/accounts', async (c) => {
    const includeArchived = c.req.query('includeArchived') === 'true';
    return c.json({ accounts: await services.accounts.list(includeArchived) });
  });

  router.post('/accounts', async (c) => {
    const input = await readJson(c, accountCreate);
    return c.json({ account: await services.accounts.create(c.var.owner.currency, input) }, 201);
  });

  router.patch('/accounts/:id', async (c) => {
    const input = await readJson(c, accountUpdate);
    return c.json({ account: await services.accounts.update(c.req.param('id'), input) });
  });

  router.delete('/accounts/:id', async (c) => {
    await services.accounts.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  router.get('/categories', async (c) => {
    return c.json({ categories: await services.categories.list(c.req.query('includeArchived') === 'true') });
  });

  router.post('/categories', async (c) => {
    const input = await readJson(c, categoryCreate);
    return c.json({ category: await services.categories.create(input) }, 201);
  });

  router.patch('/categories/:id', async (c) => {
    const input = await readJson(c, categoryUpdate);
    return c.json({ category: await services.categories.update(c.req.param('id'), input) });
  });

  router.delete('/categories/:id', async (c) => {
    await services.categories.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  return router;
}
