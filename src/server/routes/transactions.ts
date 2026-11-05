import { Hono } from 'hono';
import { z } from 'zod';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { Errors } from '../errors';
import { parseCommaList, readJson } from '../http/schemas';

const splitSchema = z.object({
  categoryId: z.string().min(6).max(128),
  amountCents: z.number().int().safe(),
  note: z.string().max(1000).optional().nullable(),
});

const transactionCreate = z.object({
  accountId: z.string().min(6).max(128),
  categoryId: z.string().min(6).max(128).optional().nullable(),
  amountCents: z.number().int().safe(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  merchant: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string().max(32)).max(12).optional(),
  excludedFromReports: z.boolean().optional(),
  splits: z.array(splitSchema).min(2).max(20).optional(),
});

const transactionUpdate = transactionCreate.partial();

const transferCreate = z.object({
  fromAccountId: z.string().min(6).max(128),
  toAccountId: z.string().min(6).max(128),
  amountCents: z.number().int().positive().safe(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(500).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

const bulkBody = z.object({
  ids: z.array(z.string().min(6).max(128)).min(1).max(500),
  action: z.enum(['delete', 'categorize', 'exclude', 'include']),
  categoryId: z.string().min(6).max(128).optional().nullable(),
});

export function createTransactionRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/transactions', async (c) => {
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);
    const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);
    const type = c.req.query('type');
    if (type && !['all', 'inflow', 'outflow'].includes(type)) throw Errors.badRequest('Invalid transaction type filter.');
    const sort = c.req.query('sort');
    if (sort && !['date_desc', 'date_asc', 'amount_desc', 'amount_asc'].includes(sort)) {
      throw Errors.badRequest('Invalid sort.');
    }
    const result = await services.transactions.list({
      limit,
      offset,
      search: c.req.query('search')?.slice(0, 200),
      from: c.req.query('from'),
      to: c.req.query('to'),
      accountIds: parseCommaList(c.req.queries('account_ids')),
      categoryIds: parseCommaList(c.req.queries('category_ids')),
      type: (type as 'all' | 'inflow' | 'outflow' | undefined) ?? 'all',
      tag: c.req.query('tag'),
      sort: (sort as 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | undefined) ?? 'date_desc',
    });
    return c.json(result);
  });

  router.get('/transactions/:id', async (c) => {
    const transaction = await services.transactions.get(c.req.param('id'));
    if (!transaction) throw Errors.notFound('Transaction not found.');
    return c.json({ transaction });
  });

  router.post('/transactions', async (c) => {
    const input = await readJson(c, transactionCreate);
    return c.json({ transaction: await services.transactions.create(input) }, 201);
  });

  router.patch('/transactions/:id', async (c) => {
    const input = await readJson(c, transactionUpdate);
    return c.json({ transaction: await services.transactions.update(c.req.param('id'), input) });
  });

  router.delete('/transactions/:id', async (c) => {
    const result = await services.transactions.delete(c.req.param('id'));
    return c.json({ ok: true, deletedIds: result.deletedIds });
  });

  router.post('/transactions/transfer', async (c) => {
    const input = await readJson(c, transferCreate);
    return c.json({ transactions: await services.transactions.createTransfer(input) }, 201);
  });

  router.post('/transactions/bulk', async (c) => {
    const input = await readJson(c, bulkBody);
    const result = await services.transactions.bulk(input.action, input.ids, input.categoryId);
    return c.json({ ok: true, affected: result.affected });
  });

  return router;
}
