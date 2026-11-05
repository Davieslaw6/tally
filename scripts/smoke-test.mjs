// End-to-end API smoke test for a fresh TALLY database.
//
//   TALLY_PGLITE_DIR=memory:// PORT=3210 COOKIE_SECURE=false npx tsx src/index.ts
//   node scripts/smoke-test.mjs http://127.0.0.1:3210
const base = process.argv[2] ?? 'http://127.0.0.1:3210';
const pin = '482915';
const jar = new Map();

function remember(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}
async function call(method, path, body, expect = [200, 201]) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(method !== 'GET' ? { origin: base } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  remember(response);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 800)}`);
  }
  return { status: response.status, json, headers: response.headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const health = await call('GET', '/api/health');
assert(health.json.status === 'ok', 'health endpoint');

const statusBefore = await call('GET', '/api/auth/status');
assert(statusBefore.json.configured === false, 'fresh ledger is unconfigured');

const setup = await call('POST', '/api/auth/setup', {
  pin,
  displayName: 'Smoke Tester',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'UTC',
});
assert(setup.json.user?.displayName === 'Smoke Tester', 'setup creates the owner');
assert(Boolean(jar.get('tally_session')), 'setup sets a session cookie');

const me = await call('GET', '/api/me');
assert(me.json.user?.id === 'owner', 'session authenticates /api/me');

const categories = await call('GET', '/api/categories');
const income = categories.json.categories.find((category) => category.name === 'Income');
const groceries = categories.json.categories.find((category) => category.name === 'Groceries');
assert(categories.json.categories.length >= 10, 'default categories seeded');

const checking = await call('POST', '/api/accounts', { name: 'Everyday Checking', type: 'checking', openingBalanceCents: 10_000 });
const savings = await call('POST', '/api/accounts', { name: 'Savings', type: 'savings' });
const checkingId = checking.json.account.id;
const savingsId = savings.json.account.id;
assert(Boolean(checkingId && savingsId), 'accounts created');

await call('POST', '/api/transactions', {
  accountId: checkingId,
  categoryId: income.id,
  amountCents: 500_000,
  date: '2026-10-01',
  description: 'October salary',
  merchant: 'Acme Corp',
  tags: ['payroll'],
});
await call('POST', '/api/transactions', {
  accountId: checkingId,
  categoryId: groceries.id,
  amountCents: -15_000,
  date: '2026-10-03',
  description: 'Weekly groceries',
  merchant: 'Corner Market',
});
await call('POST', '/api/transactions', {
  accountId: checkingId,
  categoryId: groceries.id,
  amountCents: -20_000,
  date: '2026-10-10',
  description: 'More groceries',
});
const excluded = await call('POST', '/api/transactions', {
  accountId: checkingId,
  categoryId: groceries.id,
  amountCents: -5_000,
  date: '2026-10-11',
  description: 'Excluded test purchase',
  excludedFromReports: true,
});
const transfer = await call('POST', '/api/transactions/transfer', {
  fromAccountId: checkingId,
  toAccountId: savingsId,
  amountCents: 100_000,
  date: '2026-10-12',
  description: 'Move to savings',
});
assert(transfer.json.transactions.length === 2, 'transfer creates two linked rows');

const list = await call('GET', '/api/transactions?limit=50');
assert(list.json.total === 6, 'transaction list includes the transfer pair');
const search = await call('GET', '/api/transactions?search=grocery');
assert(search.json.total === 0, 'search is literal (grocery does not match groceries)');
const search2 = await call('GET', '/api/transactions?search=groceries');
assert(search2.json.total === 2, 'search finds plaintext descriptions');
const filtered = await call('GET', `/api/transactions?account_ids=${savingsId}`);
assert(filtered.json.total === 1, 'account filter works');

const flow = await call('GET', '/api/reports/cash-flow?from=2026-10-01&to=2026-10-31&granularity=month');
assert(Array.isArray(flow.json) && flow.json.length === 1, 'cash flow returns one month bucket');
const point = flow.json[0];
assert(point.inflow === 500_000, `inflow excludes transfers (${point.inflow})`);
assert(point.outflow === 35_000, `outflow excludes transfers and hidden rows (${point.outflow})`);
assert(point.net === 465_000, 'net = inflow - outflow');
assert(point.transactionCount === 3, 'counts only reportable transactions');

const accountFlow = await call(
  'GET',
  `/api/reports/cash-flow?from=2026-10-01&to=2026-10-31&granularity=month&account_ids=${savingsId}`,
);
assert(accountFlow.json[0].inflow === 0 && accountFlow.json[0].outflow === 0, 'transfer-only account has no reportable flow');

const byCategory = await call(
  'GET',
  `/api/reports/cash-flow?from=2026-10-01&to=2026-10-31&granularity=month&category_ids=${groceries.id}`,
);
assert(byCategory.json[0].outflow === 35_000, 'category-filtered flow excludes hidden rows');

const weekly = await call('GET', '/api/reports/cash-flow?from=2026-10-01&to=2026-10-31&granularity=week');
assert(weekly.json.reduce((sum, row) => sum + row.inflow, 0) === 500_000, 'weekly buckets roll up day rows');
assert(weekly.json.every((row) => row.periodEnd >= row.periodStart), 'period bounds populated');

await call('POST', '/api/transactions/bulk', { ids: [excluded.json.transaction.id], action: 'exclude' });
const onlyIncluded = await call('GET', '/api/transactions?limit=50');
assert(onlyIncluded.json.total === 6, 'bulk visibility update keeps the row in the ledger');

const budget = await call('POST', '/api/budgets', {
  categoryId: groceries.id,
  month: '2026-10',
  amountCents: 50_000,
  alertThreshold: 80,
});
assert(budget.json.budget.spentCents === 35_000, 'budget reports category spending');
const copied = await call('POST', '/api/budgets/copy', { from: '2026-10', to: '2026-11' });
assert(copied.json.copied === 1, 'budgets copy between months');

const goal = await call('POST', '/api/goals', { name: 'Emergency fund', targetCents: 500_000 });
const contributed = await call('POST', `/api/goals/${goal.json.goal.id}/contributions`, { amountCents: 25_000 });
assert(contributed.json.goal.currentCents === 25_000, 'goal contribution updates the total');

const deleted = await call('DELETE', `/api/transactions/${transfer.json.transactions[0].id}`);
assert(deleted.json.deletedIds.length === 2, 'deleting a transfer removes both legs');

await call('POST', '/api/auth/logout');
const after = await fetch(`${base}/api/me`, { headers: { cookie: cookieHeader() } });
assert(after.status === 401, 'session is rejected after logout');

const login = await call('POST', '/api/auth/login', { pin });
assert(login.status === 200 && Boolean(jar.get('tally_session')), 'PIN login issues a new session');

const wrong = await call('POST', '/api/auth/login', { pin: '000000' }, [401]);
assert(wrong.json.message === 'That PIN did not match.', 'wrong PIN is rejected');

console.log('\nSMOKE PASS');
