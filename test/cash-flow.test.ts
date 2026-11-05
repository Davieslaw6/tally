import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CashFlowPeriod } from '../src/shared/types';
import { apiRequest, createTestContext, readJson, setupOwner, type TestContext } from './helpers';

interface Fixture {
  ctx: TestContext;
  sessionToken: string;
  accountA: string;
  accountB: string;
  groceries: string;
  dining: string;
  income: string;
}

let fixture: Fixture;

beforeAll(async () => {
  const ctx = await createTestContext();
  const owner = await setupOwner(ctx, { currency: 'USD' });
  const accountA = await ctx.services.accounts.create('USD', {
    name: 'Everyday Checking',
    type: 'checking',
    openingBalanceCents: 100_000,
  });
  const accountB = await ctx.services.accounts.create('USD', {
    name: 'Rainy Day Savings',
    type: 'savings',
    openingBalanceCents: 50_000,
  });
  const categories = await ctx.services.categories.list();
  const groceries = categories.find((category) => category.name === 'Groceries')!;
  const dining = categories.find((category) => category.name === 'Dining')!;
  const income = categories.find((category) => category.name === 'Income')!;
  const tx = ctx.services.transactions;

  await tx.create({
    accountId: accountA.id,
    categoryId: groceries.id,
    amountCents: -4_750,
    date: '2026-10-05',
    description: 'Coffee shop',
  });
  await tx.create({
    accountId: accountA.id,
    categoryId: dining.id,
    amountCents: -2_240,
    date: '2026-10-07',
    description: 'Bookstore',
  });
  await tx.create({
    accountId: accountA.id,
    categoryId: income.id,
    amountCents: 1_500,
    date: '2026-10-10',
    description: 'Refund',
  });
  await tx.createTransfer({
    fromAccountId: accountA.id,
    toAccountId: accountB.id,
    amountCents: 25_000,
    date: '2026-10-12',
    description: 'Monthly savings',
  });
  await tx.create({
    accountId: accountA.id,
    categoryId: groceries.id,
    amountCents: -9_999,
    date: '2026-10-15',
    description: 'Hidden test purchase',
    excludedFromReports: true,
  });
  await tx.create({
    accountId: accountA.id,
    categoryId: null,
    amountCents: -5_000,
    date: '2026-10-20',
    description: 'Supermarket split',
    splits: [
      { categoryId: groceries.id, amountCents: -3_000 },
      { categoryId: dining.id, amountCents: -2_000 },
    ],
  });
  await tx.create({
    accountId: accountB.id,
    categoryId: income.id,
    amountCents: 200_000,
    date: '2026-10-25',
    description: 'Interest payment',
  });

  fixture = {
    ctx,
    sessionToken: owner.sessionToken,
    accountA: accountA.id,
    accountB: accountB.id,
    groceries: groceries.id,
    dining: dining.id,
    income: income.id,
  };
});

afterAll(async () => {
  await fixture.ctx.cleanup();
});

async function flow(query: string): Promise<CashFlowPeriod[]> {
  const response = await apiRequest(fixture.ctx.app, fixture.sessionToken, `/api/reports/cash-flow?${query}`);
  expect(response.status).toBe(200);
  return readJson<CashFlowPeriod[]>(response);
}

describe('cash-flow API contract', () => {
  it('returns a bare period array with inflow, outflow, net, and counts', async () => {
    const periods = await flow('from=2026-10-01&to=2026-10-31&granularity=day');
    expect(Array.isArray(periods)).toBe(true);
    expect(periods).toHaveLength(31);
    expect(periods[0]).toMatchObject({
      period: '2026-10-01',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-01',
      inflow: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
    });
    const oct5 = periods.find((period) => period.period === '2026-10-05')!;
    expect(oct5).toMatchObject({ inflow: 0, outflow: 4_750, net: -4_750, transactionCount: 1 });
    const totals = periods.reduce(
      (sum, period) => ({
        inflow: sum.inflow + period.inflow,
        outflow: sum.outflow + period.outflow,
        net: sum.net + period.net,
        count: sum.count + period.transactionCount,
      }),
      { inflow: 0, outflow: 0, net: 0, count: 0 },
    );
    expect(totals).toEqual({ inflow: 201_500, outflow: 11_990, net: 189_510, count: 5 });
  });

  it('excludes transfers and transactions hidden from reports from every period', async () => {
    const periods = await flow('from=2026-10-01&to=2026-10-31&granularity=day');
    const transferDay = periods.find((period) => period.period === '2026-10-12')!;
    expect(transferDay).toMatchObject({ inflow: 0, outflow: 0, transactionCount: 0 });
    const hiddenDay = periods.find((period) => period.period === '2026-10-15')!;
    expect(hiddenDay).toMatchObject({ inflow: 0, outflow: 0, transactionCount: 0 });
    expect(periods.reduce((sum, period) => sum + period.transactionCount, 0)).toBe(5);
  });

  it('buckets weeks on Monday boundaries and clips partial periods', async () => {
    const periods = await flow('from=2026-10-01&to=2026-10-20&granularity=week');
    expect(periods.map((period) => period.period)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(periods[0]).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-04', transactionCount: 0 });
    expect(periods[1]).toMatchObject({ periodStart: '2026-10-05', periodEnd: '2026-10-11', transactionCount: 3 });
    expect(periods[2]).toMatchObject({ periodStart: '2026-10-12', periodEnd: '2026-10-18', transactionCount: 0 });
    expect(periods[3]).toMatchObject({ periodStart: '2026-10-19', periodEnd: '2026-10-20', transactionCount: 1 });
  });

  it('applies account and category filters without double-counting splits', async () => {
    const byAccount = await flow(`from=2026-10-01&to=2026-10-31&granularity=month&account_ids=${fixture.accountB}`);
    expect(byAccount).toHaveLength(1);
    expect(byAccount[0]).toMatchObject({ inflow: 200_000, outflow: 0, net: 200_000, transactionCount: 1 });

    const byCategory = await flow(`from=2026-10-01&to=2026-10-31&granularity=month&category_ids=${fixture.groceries}`);
    expect(byCategory[0]).toMatchObject({ inflow: 0, outflow: 7_750, net: -7_750, transactionCount: 2 });

    const income = await flow(`from=2026-10-01&to=2026-10-31&granularity=month&category_ids=${fixture.income}`);
    expect(income[0]).toMatchObject({ inflow: 201_500, outflow: 0, transactionCount: 2 });
  });

  it('supports month granularity and the default 6M range', async () => {
    const periods = await flow('from=2026-08-15&to=2026-10-20&granularity=month');
    expect(periods.map((period) => period.period)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(periods[0]).toMatchObject({ periodStart: '2026-08-15', periodEnd: '2026-08-31', transactionCount: 0 });
    expect(periods[2]).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-20', transactionCount: 4 });

    const defaultRange = await flow('');
    expect(defaultRange.length).toBe(6);
    expect(defaultRange.every((period) => /^\d{4}-\d{2}$/.test(period.period))).toBe(true);
    expect(defaultRange[0]!.periodStart.slice(8)).toBe('01');
  });

  it('exports the same periods as CSV with the TALLY wordmark and exclusion note', async () => {
    const response = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/reports/cash-flow.csv?from=2026-10-01&to=2026-10-31&granularity=month',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const body = await response.text();
    expect(body).toContain('TALLY cash flow export');
    expect(body).toContain('Currency,USD');
    expect(body).toContain('2026-10');
    expect(body).toContain('2015.00');
    expect(body).toContain('Own-account transfers and excluded transactions are omitted.');
  });
});

describe('cash-flow validation', () => {
  it('rejects invalid dates, inverted ranges, oversized ranges, and unknown filters', async () => {
    const cases = [
      'from=not-a-date&to=2026-10-31',
      'from=2026-10-31&to=2026-10-01',
      'from=2000-01-01&to=2026-10-01',
      'from=2026-10-01&to=2026-10-31&granularity=quarter',
      'from=2026-10-01&to=2026-10-31&account_ids=someone-elses-account',
      'from=2026-10-01&to=2026-10-31&category_ids=someone-elses-category',
    ];
    for (const query of cases) {
      const response = await apiRequest(fixture.ctx.app, fixture.sessionToken, `/api/reports/cash-flow?${query}`);
      expect(response.status, query).toBe(400);
    }
  });

  it('requires an authenticated session', async () => {
    const response = await fixture.ctx.app.request('/api/reports/cash-flow?from=2026-10-01&to=2026-10-31');
    expect(response.status).toBe(401);
  });
});
