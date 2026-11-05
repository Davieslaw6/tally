/**
 * Seeds a local demo ledger. It uses the real services, so the data behaves
 * exactly like data entered in the UI.
 *
 *   npm run seed -- --pin 482915 --currency NGN
 *
 * Never run this against a production database. The script refuses production
 * unless `--force` is supplied.
 */
import { loadConfig } from '../src/server/config';
import { createServices } from '../src/server/context';
import { addDays, toISODate } from '../src/shared/dates';
import { isSupportedCurrency, normalizeCurrency } from '../src/shared/currencies';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const config = loadConfig();
if (config.isProduction && !process.argv.includes('--force')) {
  console.error('Refusing to seed a production database without --force.');
  process.exit(1);
}

const pin = argument('pin', '482915');
if (!/^\d{4,12}$/.test(pin)) {
  console.error('PIN must be 4 to 12 digits.');
  process.exit(1);
}

const currencyInput = argument('currency', 'NGN').toUpperCase();
if (!isSupportedCurrency(currencyInput)) {
  console.error(`Unsupported currency: ${currencyInput}`);
  process.exit(1);
}
const currency = normalizeCurrency(currencyInput, 'NGN');
const services = await createServices(config);

try {
  if (await services.owner.isConfigured()) {
    console.error('This ledger already has a PIN. Seed a fresh database instead.');
    process.exitCode = 1;
  } else {
    await services.owner.setup({
      pin,
      displayName: 'Demo Ledger',
      currency,
      locale: currency === 'NGN' ? 'en-NG' : 'en-US',
      timezone: currency === 'NGN' ? 'Africa/Lagos' : 'UTC',
    });
    const checking = await services.accounts.create(currency, {
      name: 'Everyday Checking',
      type: 'checking',
      institution: 'Demo Bank',
      openingBalanceCents: 250_000,
    });
    const savings = await services.accounts.create(currency, {
      name: 'Rainy Day Savings',
      type: 'savings',
      institution: 'Demo Bank',
      openingBalanceCents: 500_000,
    });
    const categories = await services.categories.list();
    const category = (name: string) => categories.find((item) => item.name === name)?.id ?? null;
    const today = toISODate(new Date());
    const rows: Array<{
      accountId: string;
      amountCents: number;
      date: string;
      description: string;
      categoryId: string | null;
      merchant?: string;
    }> = [
      { accountId: checking.id, amountCents: 420_000, date: addDays(today, -76), description: 'Monthly salary', categoryId: category('Income'), merchant: 'Acme Studio' },
      { accountId: checking.id, amountCents: -180_000, date: addDays(today, -74), description: 'Rent', categoryId: category('Housing') },
      { accountId: checking.id, amountCents: -38_500, date: addDays(today, -70), description: 'Groceries run', categoryId: category('Groceries'), merchant: 'Green Market' },
      { accountId: checking.id, amountCents: -12_000, date: addDays(today, -66), description: 'Internet', categoryId: category('Utilities') },
      { accountId: checking.id, amountCents: 25_000, date: addDays(today, -62), description: 'Freelance invoice', categoryId: category('Income'), merchant: 'Northwind' },
      { accountId: checking.id, amountCents: -9_500, date: addDays(today, -58), description: 'Dinner with friends', categoryId: category('Dining') },
      { accountId: checking.id, amountCents: 420_000, date: addDays(today, -44), description: 'Monthly salary', categoryId: category('Income'), merchant: 'Acme Studio' },
      { accountId: checking.id, amountCents: -180_000, date: addDays(today, -42), description: 'Rent', categoryId: category('Housing') },
      { accountId: checking.id, amountCents: -22_750, date: addDays(today, -35), description: 'Bookstore', categoryId: category('Shopping') },
      { accountId: checking.id, amountCents: -5_000, date: addDays(today, -21), description: 'Coffee', categoryId: category('Dining') },
      { accountId: checking.id, amountCents: 420_000, date: addDays(today, -14), description: 'Monthly salary', categoryId: category('Income'), merchant: 'Acme Studio' },
      { accountId: checking.id, amountCents: -54_000, date: addDays(today, -9), description: 'Weekly groceries', categoryId: category('Groceries'), merchant: 'Green Market' },
      { accountId: savings.id, amountCents: 15_000, date: addDays(today, -4), description: 'Savings interest', categoryId: category('Income') },
    ];
    for (const row of rows) {
      await services.transactions.create({
        accountId: row.accountId,
        categoryId: row.categoryId,
        amountCents: row.amountCents,
        date: row.date,
        description: row.description,
        merchant: row.merchant ?? null,
      });
    }
    await services.transactions.createTransfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 100_000,
      date: addDays(today, -45),
      description: 'Monthly savings',
    });
    console.log(`Seeded ${rows.length} transactions plus one transfer for the demo ledger.`);
    console.log(`Sign in with the PIN supplied via --pin (${pin.length} digits).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await services.close();
}
