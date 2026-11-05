import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createTestContext, jsonRequest, readJson, setupOwner, type TestContext } from './helpers';

interface Fixture {
  ctx: TestContext;
  sessionToken: string;
  checking: { id: string };
  savings: { id: string };
  groceries: { id: string };
  dining: { id: string };
}

let fixture: Fixture;

beforeAll(async () => {
  const ctx = await createTestContext();
  const owner = await setupOwner(ctx, { currency: 'USD', timezone: 'UTC' });
  const checking = await ctx.services.accounts.create('USD', {
    name: 'Everyday Checking',
    type: 'checking',
    openingBalanceCents: 100_000,
  });
  const savings = await ctx.services.accounts.create('USD', {
    name: 'Rainy Day Savings',
    type: 'savings',
    openingBalanceCents: 50_000,
  });
  const categories = await ctx.services.categories.list();
  fixture = {
    ctx,
    sessionToken: owner.sessionToken,
    checking,
    savings,
    groceries: categories.find((category) => category.name === 'Groceries')!,
    dining: categories.find((category) => category.name === 'Dining')!,
  };
});

afterAll(async () => {
  await fixture.ctx.cleanup();
});

describe('core ledger API', () => {
  it('creates, filters, splits, hides, and deletes transactions', async () => {
    const create = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/transactions',
      jsonRequest({
        accountId: fixture.checking.id,
        categoryId: null,
        amountCents: -5_000,
        date: '2026-10-20',
        description: 'Supermarket split',
        tags: ['weekly'],
        splits: [
          { categoryId: fixture.groceries.id, amountCents: -3_000 },
          { categoryId: fixture.dining.id, amountCents: -2_000 },
        ],
      }),
    );
    expect(create.status).toBe(201);
    const created = await readJson<{ transaction: { id: string; isSplit: boolean; splits: unknown[] } }>(create);
    expect(created.transaction.isSplit).toBe(true);
    expect(created.transaction.splits).toHaveLength(2);

    const search = await apiRequest(fixture.ctx.app, fixture.sessionToken, '/api/transactions?search=supermarket');
    expect(search.status).toBe(200);
    expect((await readJson<{ total: number }>(search)).total).toBe(1);

    const byCategory = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/transactions?category_ids=${fixture.groceries.id}`,
    );
    expect((await readJson<{ total: number }>(byCategory)).total).toBe(1);

    const bulk = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/transactions/bulk',
      jsonRequest({ ids: [created.transaction.id], action: 'exclude' }),
    );
    expect(bulk.status).toBe(200);
    expect((await readJson<{ affected: number }>(bulk)).affected).toBe(1);

    const hidden = await apiRequest(fixture.ctx.app, fixture.sessionToken, `/api/transactions/${created.transaction.id}`);
    expect((await readJson<{ transaction: { excludedFromReports: boolean } }>(hidden)).transaction.excludedFromReports).toBe(true);

    const remove = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/transactions/${created.transaction.id}`,
      { method: 'DELETE' },
    );
    expect(remove.status).toBe(200);
  });

  it('creates a transfer pair and deletes both legs together', async () => {
    const transfer = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/transactions/transfer',
      jsonRequest({
        fromAccountId: fixture.checking.id,
        toAccountId: fixture.savings.id,
        amountCents: 25_000,
        date: '2026-10-12',
        description: 'Monthly savings',
      }),
    );
    expect(transfer.status).toBe(201);
    const body = await readJson<{ transactions: Array<{ id: string; isTransfer: boolean }> }>(transfer);
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions.every((transaction) => transaction.isTransfer)).toBe(true);

    const remove = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/transactions/${body.transactions[0]!.id}`,
      { method: 'DELETE' },
    );
    const removed = await readJson<{ deletedIds: string[] }>(remove);
    expect(removed.deletedIds).toHaveLength(2);
  });

  it('tracks budget spending and copies budgets between months', async () => {
    await fixture.ctx.services.transactions.create({
      accountId: fixture.checking.id,
      categoryId: fixture.groceries.id,
      amountCents: -30_000,
      date: '2026-11-04',
      description: 'Groceries',
    });

    const budget = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/budgets',
      jsonRequest({ categoryId: fixture.groceries.id, month: '2026-11', amountCents: 50_000, alertThreshold: 75 }),
    );
    expect(budget.status).toBe(201);
    const budgetBody = await readJson<{ budget: { id: string; spentCents: number; alertThreshold: number } }>(budget);
    expect(budgetBody.budget).toMatchObject({ spentCents: 30_000, alertThreshold: 75 });

    const list = await apiRequest(fixture.ctx.app, fixture.sessionToken, '/api/budgets?month=2026-11');
    expect((await readJson<{ budgets: Array<{ spentCents: number }> }>(list)).budgets[0]!.spentCents).toBe(30_000);

    const copy = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/budgets/copy',
      jsonRequest({ from: '2026-11', to: '2026-12' }),
    );
    expect((await readJson<{ copied: number }>(copy)).copied).toBe(1);
  });

  it('records goal contributions and withdrawals', async () => {
    const goal = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      '/api/goals',
      jsonRequest({ name: 'Emergency fund', targetCents: 500_000, targetDate: '2027-06-30' }),
    );
    expect(goal.status).toBe(201);
    const goalId = (await readJson<{ goal: { id: string } }>(goal)).goal.id;

    const contributed = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/goals/${goalId}/contributions`,
      jsonRequest({ amountCents: 120_000, note: 'First deposit', contributedAt: '2026-11-01' }),
    );
    expect(contributed.status).toBe(201);
    expect((await readJson<{ goal: { currentCents: number } }>(contributed)).goal.currentCents).toBe(120_000);

    const withdraw = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/goals/${goalId}/contributions`,
      jsonRequest({ amountCents: -20_000, contributedAt: '2026-11-02' }),
    );
    expect((await readJson<{ goal: { currentCents: number } }>(withdraw)).goal.currentCents).toBe(100_000);

    const history = await apiRequest(fixture.ctx.app, fixture.sessionToken, `/api/goals/${goalId}/contributions`);
    expect((await readJson<{ contributions: unknown[] }>(history)).contributions).toHaveLength(2);
  });

  it('archives accounts but refuses to delete one with history', async () => {
    const archive = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/accounts/${fixture.checking.id}`,
      jsonRequest({ archived: true }, 'PATCH'),
    );
    expect(archive.status).toBe(200);
    expect((await readJson<{ account: { archived: boolean } }>(archive)).account.archived).toBe(true);

    const remove = await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/accounts/${fixture.checking.id}`,
      { method: 'DELETE' },
    );
    expect(remove.status).toBe(409);

    await apiRequest(
      fixture.ctx.app,
      fixture.sessionToken,
      `/api/accounts/${fixture.checking.id}`,
      jsonRequest({ archived: false }, 'PATCH'),
    );
  });
});
