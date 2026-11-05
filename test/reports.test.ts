import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createTestContext, readJson, setupOwner, type TestContext } from './helpers';

interface Fixture {
  ctx: TestContext;
  sessionToken: string;
}

let fixture: Fixture;

beforeAll(async () => {
  const ctx = await createTestContext();
  const owner = await setupOwner(ctx, { currency: 'USD' });
  const account = await ctx.services.accounts.create('USD', {
    name: 'Reporting Checking',
    type: 'checking',
    openingBalanceCents: 100_000,
  });
  const categories = await ctx.services.categories.list();
  const income = categories.find((category) => category.name === 'Income')!;
  const groceries = categories.find((category) => category.name === 'Groceries')!;
  await ctx.services.transactions.create({
    accountId: account.id,
    categoryId: income.id,
    amountCents: 500_000,
    date: '2026-10-01',
    description: 'October salary',
    merchant: 'Acme Studio',
  });
  await ctx.services.transactions.create({
    accountId: account.id,
    categoryId: groceries.id,
    amountCents: -12_340,
    date: '2026-10-05',
    description: '=HYPERLINK("http://example.invalid","Open")',
    merchant: '+cmd|\' /C calc\'!A0',
    notes: '@SUM(1+1)',
  });
  fixture = { ctx, sessionToken: owner.sessionToken };
});

afterAll(async () => {
  await fixture.ctx.cleanup();
});

describe('report exports', () => {
  it('neutralises spreadsheet formulas in user-controlled CSV cells while keeping amounts numeric', async () => {
    const response = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/reports/transactions.csv?from=2026-10-01&to=2026-10-31',
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('TALLY transaction export');
    expect(body).toContain("'=HYPERLINK");
    expect(body).toContain("'+cmd");
    expect(body).toContain("'@SUM");
    expect(body).toContain(',-123.40,');
    expect(body).not.toContain(",'-123.40,");
    expect(body).toContain('October salary');
  });

  it('serves summary and monthly reports for the same range', async () => {
    const summary = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/reports/summary?from=2026-10-01&to=2026-10-31',
    );
    expect(summary.status).toBe(200);
    const summaryBody = await readJson<{ flow: { inflow: number; outflow: number; net: number }; insights: string[] }>(summary);
    expect(summaryBody.flow).toMatchObject({ inflow: 500_000, outflow: 12_340, net: 487_660 });
    expect(summaryBody.insights.length).toBeGreaterThan(0);

    const monthly = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/reports/monthly?from=2026-10-01&to=2026-10-31',
    );
    expect(monthly.status).toBe(200);
    const monthlyBody = await readJson<{ months: Array<{ month: string; inflow: number; outflow: number; net: number }> }>(monthly);
    expect(monthlyBody.months).toEqual([{ month: '2026-10', inflow: 500_000, outflow: 12_340, net: 487_660 }]);
  });

  it('rejects report ranges that are inverted or longer than ten years', async () => {
    for (const query of ['from=2026-10-31&to=2026-10-01', 'from=2000-01-01&to=2026-10-01']) {
      const response = await apiRequest(
        fixture.ctx.app,
        fixture.sessionToken,
        `/api/reports/summary?${query}`,
      );
      expect(response.status, query).toBe(400);
    }
  });
});
