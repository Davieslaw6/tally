import { Hono } from 'hono';
import type { AppServices } from '../context';
import type { AppEnv } from '../http/security';
import { Errors } from '../errors';
import { isValidISODate, presetRange, todayInTimezone, type Granularity } from '../../shared/dates';
import { parseCommaList } from '../http/schemas';

function checkedRange(from: string, to: string): { from: string; to: string } {
  if (!isValidISODate(from) || !isValidISODate(to)) throw Errors.badRequest('Invalid report date range.');
  if (from > to) throw Errors.badRequest('The start date must be before the end date.');
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (spanDays > 3_660) throw Errors.badRequest('Date range is too large. Choose up to 10 years.');
  return { from, to };
}

export function createReportRoutes(services: AppServices): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  const defaultRange = (timezone: string) => {
    const today = todayInTimezone(timezone);
    return { ...presetRange('6M', today), today };
  };

  router.get('/reports/cash-flow', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    const granularityRaw = c.req.query('granularity');
    if (granularityRaw && !['day', 'week', 'month'].includes(granularityRaw)) {
      throw Errors.badRequest('Granularity must be day, week, or month.');
    }
    return c.json(
      await services.cashFlow.getFlow({
        from,
        to,
        granularity: granularityRaw as Granularity | undefined,
        accountIds: parseCommaList(c.req.queries('account_ids')),
        categoryIds: parseCommaList(c.req.queries('category_ids')),
      }),
    );
  });

  router.get('/reports/cash-flow.csv', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    const granularity = c.req.query('granularity');
    if (granularity && !['day', 'week', 'month'].includes(granularity)) {
      throw Errors.badRequest('Granularity must be day, week, or month.');
    }
    const periods = await services.cashFlow.getFlow({
      from,
      to,
      granularity: granularity as Granularity | undefined,
      accountIds: parseCommaList(c.req.queries('account_ids')),
      categoryIds: parseCommaList(c.req.queries('category_ids')),
    });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="tally-cash-flow-${from}-to-${to}.csv"`);
    return c.body(services.reports.cashFlowCsv(periods, c.var.owner.currency));
  });

  router.get('/reports/summary', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    return c.json(await services.reports.summary(from, to));
  });

  router.get('/reports/spending', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    const kind = c.req.query('kind') === 'income' ? 'income' : 'expense';
    return c.json({ kind, from, to, categories: await services.reports.spending(from, to, kind) });
  });

  router.get('/reports/net-worth', async (c) => {
    const months = Number.parseInt(c.req.query('months') ?? '12', 10);
    return c.json({ points: await services.reports.netWorthTrend(Number.isFinite(months) ? months : 12) });
  });

  router.get('/reports/transactions.csv', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="tally-transactions-${from}-to-${to}.csv"`);
    return c.body(await services.reports.transactionsCsv(from, to));
  });

  router.get('/reports/monthly', async (c) => {
    const fallback = defaultRange(c.var.owner.timezone);
    const { from, to } = checkedRange(c.req.query('from') ?? fallback.from, c.req.query('to') ?? fallback.to);
    return c.json({ months: await services.reports.summaryByMonth(from, to) });
  });

  return router;
}
