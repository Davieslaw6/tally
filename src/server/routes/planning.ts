import { Hono } from 'hono';
import { z } from 'zod';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { Errors } from '../errors';
import { readJson } from '../http/schemas';
import { monthKey, todayInTimezone } from '../../shared/dates';

const money = z.number().int().safe();
const month = z.string().regex(/^\d{4}-\d{2}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const budgetCreate = z.object({
  categoryId: z.string().min(6).max(128),
  month,
  amountCents: money.positive(),
  alertThreshold: z.number().int().min(1).max(100).optional(),
});
const budgetPatch = z.object({
  amountCents: money.positive().optional(),
  alertThreshold: z.number().int().min(1).max(100).optional(),
});
const budgetCopy = z.object({ from: month, to: month });

const goalCreate = z.object({
  name: z.string().min(1).max(80),
  targetCents: money.positive(),
  targetDate: date.nullable().optional(),
  color: z.string().max(120).optional(),
});
const goalPatch = goalCreate.partial();
const contributionCreate = z.object({
  amountCents: money.refine((value) => value !== 0, 'Contribution must be non-zero.'),
  note: z.string().max(1000).nullable().optional(),
  contributedAt: date.optional(),
});

export function createPlanningRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  const defaultMonth = (timezone: string) => monthKey(todayInTimezone(timezone));

  router.get('/budgets', async (c) => {
    const value = c.req.query('month') ?? defaultMonth(c.var.owner.timezone);
    if (!/^\d{4}-\d{2}$/.test(value)) throw Errors.badRequest('Month must use YYYY-MM.');
    return c.json({ month: value, budgets: await services.budgets.list(value) });
  });

  router.post('/budgets', async (c) => {
    const input = await readJson(c, budgetCreate);
    return c.json({ budget: await services.budgets.create(input) }, 201);
  });

  router.post('/budgets/copy', async (c) => {
    const input = await readJson(c, budgetCopy);
    const copied = await services.budgets.copy(input.from, input.to);
    return c.json({ copied, month: input.to });
  });

  router.patch('/budgets/:id', async (c) => {
    const input = await readJson(c, budgetPatch);
    return c.json({ budget: await services.budgets.update(c.req.param('id'), input) });
  });

  router.delete('/budgets/:id', async (c) => {
    await services.budgets.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  router.get('/goals', async (c) => {
    return c.json({ goals: await services.goals.list() });
  });

  router.post('/goals', async (c) => {
    const input = await readJson(c, goalCreate);
    return c.json({ goal: await services.goals.create(input) }, 201);
  });

  router.patch('/goals/:id', async (c) => {
    const input = await readJson(c, goalPatch);
    return c.json({ goal: await services.goals.update(c.req.param('id'), input) });
  });

  router.delete('/goals/:id', async (c) => {
    await services.goals.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  router.get('/goals/:id/contributions', async (c) => {
    return c.json({ contributions: await services.goals.contributions(c.req.param('id')) });
  });

  router.post('/goals/:id/contributions', async (c) => {
    const input = await readJson(c, contributionCreate);
    return c.json({ goal: await services.goals.contribute(c.req.param('id'), input) }, 201);
  });

  router.delete('/goals/:id/contributions/:contributionId', async (c) => {
    await services.goals.removeContribution(c.req.param('id'), c.req.param('contributionId'));
    return c.json({ ok: true });
  });

  return router;
}
