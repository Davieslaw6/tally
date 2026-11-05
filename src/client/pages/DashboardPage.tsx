import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, CircleAlert, Plus, ReceiptText, Target } from 'lucide-react';
import type { CashflowView, Granularity } from '../../shared/types';
import type { RangePreset } from '../../shared/dates';
import {
  autoGranularity,
  currentMonth,
  monthLabel,
  readCustomRange,
  rangeForPreset,
  rangeLabel,
  saveCustomRange,
  type DateRange,
} from '../lib/finance';
import { useSession, useMoney } from '../lib/session';
import { api, type CashFlowQuery } from '../lib/api';
import { useToast } from '../components/Toast';
import { CashFlowChart } from '../components/CashFlowChart';
import { EmptyState, ErrorState, LoadingBlock, PageHead } from '../components/ui';

const VALID_RANGES: RangePreset[] = ['1M', '3M', '6M', '1Y', 'YTD', 'custom'];

function asRange(value: string | undefined): RangePreset {
  return VALID_RANGES.includes(value as RangePreset) ? (value as RangePreset) : '6M';
}

export function DashboardPage() {
  const { user, settings, updateSettings } = useSession();
  const toast = useToast();
  const money = useMoney();
  const timezone = user?.timezone || 'UTC';
  const [range, setRange] = useState<RangePreset>(() => asRange(settings?.chartRange));
  const [view, setView] = useState<CashflowView>(() => settings?.chartView ?? 'bar');
  const [customRange, setCustomRange] = useState<DateRange>(() => readCustomRange(timezone));

  const { from, to } = useMemo(() => {
    if (range === 'custom') {
      if (customRange.from && customRange.to && customRange.from <= customRange.to) return customRange;
      return rangeForPreset('6M', timezone);
    }
    return rangeForPreset(range, timezone);
  }, [range, customRange, timezone]);

  const granularity: Granularity = useMemo(() => autoGranularity(from, to), [from, to]);
  const query: CashFlowQuery = useMemo(() => ({ from, to, granularity }), [from, to, granularity]);

  const summary = useQuery({
    queryKey: ['summary', from, to],
    queryFn: () => api.summary({ from, to }),
  });
  const cashFlow = useQuery({
    queryKey: ['cashflow', query],
    queryFn: () => api.cashFlow(query),
  });
  const recent = useQuery({
    queryKey: ['transactions', { limit: 7, sort: 'date_desc', recent: true }],
    queryFn: () => api.transactions({ limit: 7, sort: 'date_desc' }),
  });
  const month = currentMonth(timezone);
  const budgets = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => api.budgets(month),
  });

  const flow = summary.data?.flow;
  const previous = summary.data?.previousFlow;
  const budgetRows = (budgets.data?.budgets ?? []).slice(0, 3);

  const persistRange = async (next: RangePreset) => {
    setRange(next);
    try {
      await updateSettings({ chartRange: next });
    } catch {
      toast.error('The range preference could not be saved, but this view still works.');
    }
  };

  const persistView = async (next: CashflowView) => {
    setView(next);
    try {
      await updateSettings({ chartView: next });
    } catch {
      toast.error('The chart style could not be saved.');
    }
  };

  const updateCustom = (next: DateRange) => {
    setCustomRange(next);
    saveCustomRange(next);
  };

  const periodLabel = rangeLabel(from, to, user?.locale);
  const currentMonthLabel = monthLabel(month, user?.locale);

  return (
    <div className="page">
      <PageHead
        title="Overview"
        sub={
          <>
            {currentMonthLabel} · <strong>{periodLabel}</strong> at a glance. Every dollar, accounted for.
          </>
        }
        actions={
          <Link to="/transactions?new=1" className="btn btn-primary">
            <Plus size={15} /> <span className="btn-label">Add transaction</span>
          </Link>
        }
      />

      {summary.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="The summary could not be loaded"
            message={summary.error instanceof Error ? summary.error.message : undefined}
            onRetry={() => void summary.refetch()}
          />
        </div>
      ) : null}

      <section className="kpi-strip" aria-label="Key figures">
        <div className="kpi">
          <div className="kpi-label">Total balance</div>
          {summary.isLoading ? (
            <div className="skeleton" style={{ height: 34, width: '68%', marginTop: 8 }} />
          ) : (
            <div className="kpi-value lead">{money(summary.data?.currentBalanceCents ?? 0)}</div>
          )}
          <div className="kpi-delta">Across active accounts</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <span className="key-swatch" aria-hidden="true" /> Inflow
          </div>
          {summary.isLoading ? (
            <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} />
          ) : (
            <div className="kpi-value">{money(flow?.inflow ?? 0)}</div>
          )}
          <Delta current={flow?.inflow ?? 0} previous={previous?.inflow ?? 0} favorable={1} money={money} />
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <span className="key-swatch out" aria-hidden="true" /> Outflow
          </div>
          {summary.isLoading ? (
            <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} />
          ) : (
            <div className="kpi-value">{money(flow?.outflow ?? 0)}</div>
          )}
          <Delta current={flow?.outflow ?? 0} previous={previous?.outflow ?? 0} favorable={-1} money={money} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Net saved</div>
          {summary.isLoading ? (
            <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} />
          ) : (
            <div className={`kpi-value ${(flow?.net ?? 0) >= 0 ? 'positive' : 'negative'}`}>
              {money(flow?.net ?? 0, { signed: true })}
            </div>
          )}
          <div className="kpi-delta">
            {summary.data && summary.data.flow.inflow > 0
              ? `${summary.data.savingsRate}% of inflow kept`
              : 'No inflow recorded yet'}
          </div>
        </div>
      </section>

      <CashFlowChart
        periods={cashFlow.data ?? []}
        granularity={granularity}
        view={view}
        onViewChange={(next) => void persistView(next)}
        range={range}
        onRangeChange={(next) => void persistRange(next)}
        customRange={customRange}
        onCustomRangeChange={updateCustom}
        query={query}
        loading={cashFlow.isLoading}
        error={cashFlow.isError ? (cashFlow.error as Error) : null}
        onRetry={() => void cashFlow.refetch()}
      />

      <div className="dashboard-lower">
        <section className="card card-pad" aria-label="Largest spending categories">
          <div className="section-head">
            <h2 className="section-title">Where it went</h2>
            <Link to="/reports" className="link" style={{ fontSize: 12 }}>
              Reports
            </Link>
          </div>
          {summary.isLoading ? (
            <LoadingBlock lines={4} label="Loading categories" />
          ) : summary.data?.topCategories.length ? (
            <div className="rank-list">
              {summary.data.topCategories.map((category) => {
                const max = summary.data?.topCategories[0]?.amountCents || 1;
                return (
                  <div className="rank-row" key={category.categoryId ?? category.name}>
                    <span className="rank-name">
                      <span
                        className="cat-dot"
                        style={{ display: 'inline-block', marginRight: 7, background: category.color }}
                      />
                      {category.name}
                    </span>
                    <span className="rank-value">{money(category.amountCents)}</span>
                    <span className="rank-track" aria-hidden="true">
                      <span
                        className="rank-bar"
                        style={{ width: `${Math.max(2, (category.amountCents / max) * 100)}%` }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No spending in this range" copy="Expenses will appear here once you add transactions." />
          )}
          {summary.data?.topMerchants.length ? (
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
              <div className="hint" style={{ marginBottom: 8 }}>
                Top merchants
              </div>
              <div className="simple-list">
                {summary.data.topMerchants.slice(0, 3).map((merchant) => (
                  <div className="simple-row" key={merchant.merchant} style={{ padding: '7px 0' }}>
                    <div className="simple-row-main">
                      <div className="simple-row-title">{merchant.merchant}</div>
                      <div className="simple-row-sub">
                        {merchant.count} transaction{merchant.count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className="num muted" style={{ fontSize: 12 }}>
                      {money(merchant.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="card card-pad" aria-label="Recent activity">
          <div className="section-head">
            <h2 className="section-title">Recent activity</h2>
            <Link to="/transactions" className="link" style={{ fontSize: 12 }}>
              View all
            </Link>
          </div>
          {recent.isLoading ? (
            <LoadingBlock lines={5} label="Loading recent transactions" />
          ) : recent.data?.items.length ? (
            <div className="activity-list">
              {recent.data.items.map((transaction) => {
                const date = new Date(`${transaction.date}T12:00:00Z`);
                const monthShort = new Intl.DateTimeFormat(user?.locale || 'en-US', {
                  month: 'short',
                  timeZone: 'UTC',
                })
                  .format(date)
                  .toUpperCase();
                const day = new Intl.DateTimeFormat(user?.locale || 'en-US', {
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(date);
                return (
                  <Link
                    key={transaction.id}
                    to={`/transactions?focus=${transaction.id}`}
                    className="activity-row"
                  >
                    <span className="activity-date">
                      <strong>{day}</strong>
                      {monthShort}
                    </span>
                    <span className="activity-main">
                      <span className="activity-desc">{transaction.description}</span>
                      <span className="activity-meta">
                        {transaction.accountName}
                        {transaction.categoryName ? ` · ${transaction.categoryName}` : ''}
                        {transaction.isTransfer ? ' · Transfer' : ''}
                        {transaction.excludedFromReports ? ' · Hidden' : ''}
                      </span>
                    </span>
                    <span className={`activity-amount ${transaction.amountCents >= 0 ? 'positive' : ''}`}>
                      {money(transaction.amountCents, { signed: true })}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<ReceiptText size={16} />}
              title="The ledger is quiet"
              copy="Add your first transaction to bring this page to life."
              action={
                <Link to="/transactions?new=1" className="btn btn-sm">
                  Add a transaction
                </Link>
              }
            />
          )}
        </section>

        <section className="card card-pad" aria-label="Budget pulse">
          <div className="section-head">
            <h2 className="section-title">Budget pulse</h2>
            <Link to="/plan" className="link" style={{ fontSize: 12 }}>
              Plan
            </Link>
          </div>
          {budgets.isLoading ? (
            <LoadingBlock lines={3} label="Loading budgets" />
          ) : budgetRows.length ? (
            <div className="rank-list">
              {budgetRows.map((budget) => {
                const percent = budget.amountCents > 0 ? Math.round((budget.spentCents / budget.amountCents) * 100) : 0;
                return (
                  <div className="rank-row" key={budget.id}>
                    <span className="rank-name">
                      <span
                        className="cat-dot"
                        style={{ display: 'inline-block', marginRight: 7, background: budget.categoryColor }}
                      />
                      {budget.categoryName}
                    </span>
                    <span className={`rank-value ${percent > 100 ? 'negative' : ''}`}>{percent}%</span>
                    <span className="rank-track" aria-hidden="true">
                      <span
                        className="rank-bar"
                        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Target size={16} />}
              title="No budgets this month"
              copy="Set a monthly limit for a category to see it here."
              action={
                <Link to="/plan" className="btn btn-sm">
                  Set a budget
                </Link>
              }
            />
          )}
          {summary.data?.insights.length ? (
            <p className="hint" style={{ borderTop: '1px solid var(--rule)', paddingTop: 11, color: 'var(--muted)' }}>
              {summary.data.insights[0]}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Delta({
  current,
  previous,
  favorable,
  money,
}: {
  current: number;
  previous: number;
  favorable: 1 | -1;
  money: ReturnType<typeof useMoney>;
}) {
  if (previous === 0) {
    return <div className="kpi-delta">{current === 0 ? 'No activity yet' : 'First activity in this range'}</div>;
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const increasing = change >= 0;
  const good = (increasing ? 1 : -1) * favorable === 1;
  return (
    <div className="kpi-delta" title={`Previous period: ${money(previous)}`}>
      {increasing ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
      <strong className={good ? 'positive' : 'negative'}>{Math.abs(change).toFixed(1)}%</strong>
      <span>vs previous</span>
      <CircleAlert size={11} style={{ opacity: 0.35 }} aria-hidden="true" />
    </div>
  );
}
