import type { SqlClient } from '../db/sql';
import type { CashFlowPeriod, DashboardSummary } from '../../shared/types';
import { centsToDecimal, formatMoney } from '../../shared/money';
import {
  addMonths,
  endOfMonth,
  isValidISODate,
  monthKey,
  previousPeriod,
  startOfMonth,
  todayInTimezone,
} from '../../shared/dates';
import { Errors } from '../errors';
import { CashFlowService, totalsFromPeriods } from './cash-flow-service';
import { OWNER_ID } from './owner-service';

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  color: string;
  amountCents: number;
  transactionCount: number;
  share: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function assertRange(from: string, to: string): void {
  if (!isValidISODate(from) || !isValidISODate(to)) throw Errors.badRequest('Invalid report date range.');
  if (from > to) throw Errors.badRequest('The start date must be before the end date.');
}

function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formulas in user-controlled text while leaving
  // signed numbers such as -12.50 numeric for Excel and LibreOffice.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: Array<Array<string | number | null | undefined>>): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export class ReportService {
  constructor(
    private readonly client: SqlClient,
    private readonly cashFlow: CashFlowService,
  ) {}

  private async ownerCurrency(): Promise<string> {
    const row = (await this.client.prepare('SELECT currency FROM owner WHERE id = ?').get(OWNER_ID)) as
      | { currency: string }
      | undefined;
    return row?.currency ?? 'USD';
  }

  async summary(from: string, to: string): Promise<DashboardSummary & { insights: string[] }> {
    assertRange(from, to);
    const currency = await this.ownerCurrency();
    const totals = totalsFromPeriods(await this.cashFlow.getFlow({ from, to }));
    const previous = previousPeriod(from, to);
    const previousTotals = totalsFromPeriods(
      await this.cashFlow.getFlow({ from: previous.from, to: previous.to }),
    );
    const balance = await this.balance();
    const categoryRows = (await this.client
      .prepare(
        `SELECT a.category_id AS category_id, COALESCE(c.name, 'Uncategorized') AS name,
           COALESCE(c.color, 'oklch(0.65 0.02 250)') AS color, SUM(-a.allocation_amount_cents) AS amount_cents,
           COUNT(DISTINCT a.transaction_id) AS transaction_count
         FROM transaction_allocations a
         LEFT JOIN categories c ON c.id = a.category_id
         WHERE a.txn_date BETWEEN ? AND ? AND a.allocation_amount_cents < 0
           AND a.is_transfer = 0 AND a.excluded_from_reports = 0
         GROUP BY a.category_id, c.name, c.color
         ORDER BY amount_cents DESC LIMIT 6`,
      )
      .all(from, to)) as Array<{
      category_id: string | null;
      name: string;
      color: string;
      amount_cents: number;
      transaction_count: number;
    }>;
    const merchantRows = (await this.client
      .prepare(
        `SELECT description, merchant, amount_cents FROM transactions
         WHERE txn_date BETWEEN ? AND ? AND amount_cents < 0 AND is_transfer = 0 AND excluded_from_reports = 0
         ORDER BY txn_date DESC LIMIT 20000`,
      )
      .all(from, to)) as Array<{ description: string; merchant: string | null; amount_cents: number }>;
    const merchants = new Map<string, { merchant: string; amountCents: number; count: number }>();
    for (const row of merchantRows) {
      const merchant = (row.merchant ?? row.description).replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!merchant) continue;
      const key = merchant.toLowerCase();
      const current = merchants.get(key) ?? { merchant, amountCents: 0, count: 0 };
      current.amountCents += Math.abs(row.amount_cents);
      current.count += 1;
      merchants.set(key, current);
    }
    const topMerchants = [...merchants.values()].sort((a, b) => b.amountCents - a.amountCents).slice(0, 6);
    const savingsRate = totals.inflow > 0 ? round1((totals.net / totals.inflow) * 100) : 0;

    const insights: string[] = [];
    if (totals.inflow > 0) {
      insights.push(
        savingsRate >= 20
          ? `You kept ${savingsRate}% of inflow this period — a healthy margin.`
          : `You kept ${Math.max(0, savingsRate)}% of inflow this period. A 20% cushion is a useful target.`,
      );
    }
    if (categoryRows[0]) {
      insights.push(
        `${categoryRows[0].name} is your largest expense at ${formatMoney(categoryRows[0].amount_cents, currency, 'en-US', { maximumFractionDigits: 0 })}.`,
      );
    }
    if (previousTotals.net !== 0 && totals.inflow > 0) {
      const delta = totals.net - previousTotals.net;
      insights.push(
        delta >= 0
          ? `Net cash flow is ${formatMoney(delta, currency, 'en-US', { maximumFractionDigits: 0 })} higher than the previous period.`
          : `Net cash flow is ${formatMoney(Math.abs(delta), currency, 'en-US', { maximumFractionDigits: 0 })} lower than the previous period.`,
      );
    }

    return {
      currentBalanceCents: balance,
      openingBalanceCents: await this.openingBalance(),
      netWorthCents: balance,
      period: { from, to },
      flow: { inflow: totals.inflow, outflow: totals.outflow, net: totals.net },
      previousFlow: { inflow: previousTotals.inflow, outflow: previousTotals.outflow, net: previousTotals.net },
      savingsRate,
      topCategories: categoryRows.map((row) => ({
        categoryId: row.category_id,
        name: row.name,
        color: row.color,
        amountCents: row.amount_cents,
      })),
      topMerchants,
      insights,
    };
  }

  private async openingBalance(): Promise<number> {
    const row = (await this.client
      .prepare('SELECT COALESCE(SUM(opening_balance_cents), 0) AS total FROM accounts WHERE archived = 0')
      .get()) as { total: number };
    return row.total;
  }

  async balance(): Promise<number> {
    const rows = (await this.client
      .prepare(
        `SELECT a.opening_balance_cents + COALESCE((
           SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = a.id
         ), 0) AS balance
         FROM accounts a WHERE a.archived = 0`,
      )
      .all()) as Array<{ balance: number }>;
    return rows.reduce((sum, row) => sum + row.balance, 0);
  }

  async spending(from: string, to: string, kind: 'expense' | 'income' = 'expense'): Promise<CategorySpend[]> {
    assertRange(from, to);
    const sign = kind === 'expense' ? '<' : '>';
    const expression = kind === 'expense' ? '-a.allocation_amount_cents' : 'a.allocation_amount_cents';
    const rows = (await this.client
      .prepare(
        `SELECT a.category_id AS category_id, COALESCE(c.name, 'Uncategorized') AS name,
           COALESCE(c.color, 'oklch(0.65 0.02 250)') AS color, SUM(${expression}) AS amount_cents,
           COUNT(DISTINCT a.transaction_id) AS transaction_count
         FROM transaction_allocations a
         LEFT JOIN categories c ON c.id = a.category_id
         WHERE a.txn_date BETWEEN ? AND ? AND a.allocation_amount_cents ${sign} 0
           AND a.is_transfer = 0 AND a.excluded_from_reports = 0
         GROUP BY a.category_id, c.name, c.color
         ORDER BY amount_cents DESC`,
      )
      .all(from, to)) as Array<{
      category_id: string | null;
      name: string;
      color: string;
      amount_cents: number;
      transaction_count: number;
    }>;
    const total = rows.reduce((sum, row) => sum + row.amount_cents, 0);
    return rows.map((row) => ({
      categoryId: row.category_id,
      name: row.name,
      color: row.color,
      amountCents: row.amount_cents,
      transactionCount: row.transaction_count,
      share: total > 0 ? round1((row.amount_cents / total) * 100) : 0,
    }));
  }

  async netWorthTrend(months = 12): Promise<Array<{ month: string; balanceCents: number }>> {
    const count = Math.min(Math.max(Math.trunc(months), 1), 60);
    const today = todayInTimezone('UTC');
    const current = startOfMonth(today);
    const points: Array<{ month: string; balanceCents: number }> = [];
    for (let index = count - 1; index >= 0; index -= 1) {
      const month = startOfMonth(addMonths(current, -index));
      const end = endOfMonth(month);
      const row = (await this.client
        .prepare(
          `SELECT COALESCE(SUM(a.opening_balance_cents), 0) + COALESCE((
             SELECT SUM(t.amount_cents) FROM transactions t
             WHERE t.txn_date <= ? AND t.account_id IN (
               SELECT id FROM accounts WHERE created_at <= ? AND archived = 0
             )
           ), 0) AS balance
           FROM accounts a WHERE a.created_at <= ? AND a.archived = 0`,
        )
        .get(end, `${end}T23:59:59.999Z`, `${end}T23:59:59.999Z`)) as { balance: number };
      points.push({ month: monthKey(month), balanceCents: row.balance });
    }
    return points;
  }

  cashFlowCsv(periods: CashFlowPeriod[], currency = 'USD'): string {
    const totals = totalsFromPeriods(periods);
    return csv([
      ['TALLY cash flow export'],
      ['Currency', currency],
      ['Generated', new Date().toISOString()],
      [],
      ['Period', 'Period start', 'Period end', 'Inflow', 'Outflow', 'Net', 'Transactions'],
      ...periods.map((period) => [
        period.period,
        period.periodStart,
        period.periodEnd,
        centsToDecimal(period.inflow),
        centsToDecimal(period.outflow),
        centsToDecimal(period.net),
        period.transactionCount,
      ]),
      [
        'Total',
        '',
        '',
        centsToDecimal(totals.inflow),
        centsToDecimal(totals.outflow),
        centsToDecimal(totals.net),
        totals.transactionCount,
      ],
      [],
      ['Inflow = money received. Outflow = money spent. Own-account transfers and excluded transactions are omitted.'],
    ]);
  }

  async transactionsCsv(from: string, to: string): Promise<string> {
    assertRange(from, to);
    const rows = (await this.client
      .prepare(
        `SELECT t.*, a.name AS account_name, c.name AS category_name FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.txn_date BETWEEN ? AND ? ORDER BY t.txn_date ASC, t.created_at ASC LIMIT 50000`,
      )
      .all(from, to)) as Array<{
      txn_date: string;
      account_name: string;
      category_name: string | null;
      amount_cents: number;
      description: string;
      merchant: string | null;
      notes: string | null;
      tags: string;
      is_transfer: number;
      excluded_from_reports: number;
    }>;
    return csv([
      ['TALLY transaction export'],
      ['Generated', new Date().toISOString()],
      [],
      ['Date', 'Account', 'Category', 'Amount', 'Description', 'Merchant', 'Notes', 'Tags', 'Transfer', 'Excluded'],
      ...rows.map((row) => [
        row.txn_date,
        row.account_name,
        row.category_name ?? '',
        centsToDecimal(row.amount_cents),
        row.description,
        row.merchant ?? '',
        row.notes ?? '',
        parseTags(row.tags).join(' | '),
        row.is_transfer ? 'yes' : 'no',
        row.excluded_from_reports ? 'yes' : 'no',
      ]),
    ]);
  }

  async summaryByMonth(
    from: string,
    to: string,
  ): Promise<Array<{ month: string; inflow: number; outflow: number; net: number }>> {
    return (await this.cashFlow.getFlow({ from, to, granularity: 'month' })).map((period) => ({
      month: period.period,
      inflow: period.inflow,
      outflow: period.outflow,
      net: period.net,
    }));
  }
}
