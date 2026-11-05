import type { SqlClient, SqlParam } from '../db/sql';
import type { CashFlowPeriod, CashFlowTotals, Granularity } from '../../shared/types';
import { autoGranularity, isValidISODate, periodsBetween } from '../../shared/dates';
import { Errors } from '../errors';

export interface CashFlowQuery {
  from: string;
  to: string;
  granularity?: Granularity;
  accountIds?: string[];
  categoryIds?: string[];
}

interface DayRow {
  day: string;
  inflow_cents: number;
  outflow_cents: number;
  transaction_count: number;
}

export function emptyTotals(): CashFlowTotals {
  return { inflow: 0, outflow: 0, net: 0, transactionCount: 0 };
}

export function totalsFromPeriods(periods: CashFlowPeriod[]): CashFlowTotals {
  return periods.reduce<CashFlowTotals>(
    (totals, point) => ({
      inflow: totals.inflow + point.inflow,
      outflow: totals.outflow + point.outflow,
      net: totals.net + point.net,
      transactionCount: totals.transactionCount + point.transactionCount,
    }),
    emptyTotals(),
  );
}

/**
 * The canonical inflow/outflow definition used by the chart, dashboard, and
 * reports:
 *   inflow  = sum(max(signed_amount, 0))
 *   outflow = sum(max(-signed_amount, 0))
 * excluding own-account transfers and explicitly excluded transactions.
 *
 * Category-filtered queries read transaction_allocations so splits count
 * exactly once. Without a category filter we aggregate the parent transaction.
 */
export class CashFlowService {
  constructor(private readonly client: SqlClient) {}

  async assertFilters(query: Pick<CashFlowQuery, 'accountIds' | 'categoryIds'>): Promise<void> {
    if (query.accountIds?.length) {
      if (query.accountIds.length > 50) throw Errors.badRequest('Too many account filters.');
      const rows = (await this.client
        .prepare(`SELECT id FROM accounts WHERE id IN (${query.accountIds.map(() => '?').join(',')})`)
        .all(...query.accountIds)) as Array<{ id: string }>;
      if (new Set(rows.map((row) => row.id)).size !== new Set(query.accountIds).size) {
        throw Errors.badRequest('One or more selected accounts were not found.');
      }
    }
    if (query.categoryIds?.length) {
      if (query.categoryIds.length > 50) throw Errors.badRequest('Too many category filters.');
      const rows = (await this.client
        .prepare(`SELECT id FROM categories WHERE id IN (${query.categoryIds.map(() => '?').join(',')})`)
        .all(...query.categoryIds)) as Array<{ id: string }>;
      if (new Set(rows.map((row) => row.id)).size !== new Set(query.categoryIds).size) {
        throw Errors.badRequest('One or more selected categories were not found.');
      }
    }
  }

  async getFlow(query: CashFlowQuery): Promise<CashFlowPeriod[]> {
    if (!isValidISODate(query.from) || !isValidISODate(query.to)) throw Errors.badRequest('Invalid date range.');
    if (query.from > query.to) throw Errors.badRequest('The start date must be before the end date.');
    const spanDays = (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000;
    if (spanDays > 3_660) throw Errors.badRequest('Date range is too large. Choose up to 10 years.');
    if (query.granularity && !['day', 'week', 'month'].includes(query.granularity)) {
      throw Errors.badRequest('Granularity must be day, week, or month.');
    }
    await this.assertFilters(query);

    const granularity = query.granularity ?? autoGranularity(query.from, query.to);
    const useAllocations = Boolean(query.categoryIds?.length);
    const source = useAllocations ? 'a' : 't';
    const clauses = [
      `${source}.txn_date >= ?`,
      `${source}.txn_date <= ?`,
      `${source}.is_transfer = 0`,
      `${source}.excluded_from_reports = 0`,
    ];
    const params: SqlParam[] = [query.from, query.to];
    if (query.accountIds?.length) {
      clauses.push(`${source}.account_id IN (${query.accountIds.map(() => '?').join(',')})`);
      params.push(...query.accountIds);
    }
    if (useAllocations && query.categoryIds?.length) {
      clauses.push(`a.category_id IN (${query.categoryIds.map(() => '?').join(',')})`);
      params.push(...query.categoryIds);
    }
    const amountExpr = useAllocations ? 'a.allocation_amount_cents' : 't.amount_cents';
    const idExpr = useAllocations ? 'a.transaction_id' : 't.id';
    const table = useAllocations ? 'transaction_allocations a' : 'transactions t';
    const dayExpr = `${source}.txn_date`;
    const sql = `
      SELECT
        ${dayExpr} AS day,
        COALESCE(SUM(CASE WHEN ${amountExpr} > 0 THEN ${amountExpr} ELSE 0 END), 0) AS inflow_cents,
        COALESCE(SUM(CASE WHEN ${amountExpr} < 0 THEN -${amountExpr} ELSE 0 END), 0) AS outflow_cents,
        COUNT(DISTINCT ${idExpr}) AS transaction_count
      FROM ${table}
      WHERE ${clauses.join(' AND ')}
      GROUP BY ${dayExpr}
      ORDER BY day ASC
    `;
    const rows = (await this.client.prepare(sql).all(...params)) as DayRow[];
    const periods = periodsBetween(query.from, query.to, granularity);
    const byPeriod = new Map<string, CashFlowPeriod>();
    for (const period of periods) {
      byPeriod.set(period.key, {
        period: period.key,
        periodStart: period.start,
        periodEnd: period.end,
        inflow: 0,
        outflow: 0,
        net: 0,
        transactionCount: 0,
      });
    }
    for (const row of rows) {
      const bucket = bucketForDay(row.day, granularity);
      const target = byPeriod.get(bucket);
      if (!target) continue;
      target.inflow += row.inflow_cents;
      target.outflow += row.outflow_cents;
      target.net = target.inflow - target.outflow;
      target.transactionCount += row.transaction_count;
    }
    return [...byPeriod.values()];
  }

  totals(periods: CashFlowPeriod[]): CashFlowTotals {
    return totalsFromPeriods(periods);
  }
}

function bucketForDay(day: string, granularity: Granularity): string {
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') {
    const date = new Date(`${day}T00:00:00Z`);
    const dayOfWeek = date.getUTCDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    date.setUTCDate(date.getUTCDate() + diff);
    return date.toISOString().slice(0, 10);
  }
  return day;
}
