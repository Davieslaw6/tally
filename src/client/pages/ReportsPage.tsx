import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import type { Granularity } from '../../shared/types';
import type { RangePreset } from '../../shared/dates';
import { autoGranularity, readCustomRange, rangeForPreset, rangeLabel, saveCustomRange, type DateRange } from '../lib/finance';
import { api } from '../lib/api';
import { useMoney, useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingBlock, PageHead, Spinner, StatusPill } from '../components/ui';

const RANGES: Array<{ value: Exclude<RangePreset, 'custom'>; label: string }> = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'YTD', label: 'YTD' },
];

type ExportKind = 'cashflow' | 'transactions';

export function ReportsPage() {
  const { user } = useSession();
  const money = useMoney();
  const toast = useToast();
  const timezone = user?.timezone || 'UTC';
  const [preset, setPreset] = useState<Exclude<RangePreset, 'custom'>>('6M');
  const [customRange, setCustomRange] = useState<DateRange>(() => readCustomRange(timezone));
  const [custom, setCustom] = useState(false);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const { from, to } = useMemo(() => {
    if (custom) {
      if (customRange.from && customRange.to && customRange.from <= customRange.to) return customRange;
      return rangeForPreset('6M', timezone);
    }
    return rangeForPreset(preset, timezone);
  }, [custom, customRange, preset, timezone]);

  const granularity: Granularity = useMemo(() => autoGranularity(from, to), [from, to]);

  const summary = useQuery({ queryKey: ['summary', from, to], queryFn: () => api.summary({ from, to }) });
  const monthly = useQuery({ queryKey: ['monthly', from, to], queryFn: () => api.monthly({ from, to }) });
  const spending = useQuery({ queryKey: ['spending', from, to, kind], queryFn: () => api.spending({ from, to, kind }) });

  const months = monthly.data?.months ?? [];
  const categories = spending.data?.categories ?? [];
  const totals = summary.data?.flow;
  const maxMonth = Math.max(1, ...months.flatMap((month) => [month.inflow, month.outflow]));
  const maxSpend = Math.max(1, ...categories.map((category) => category.amountCents));
  const selectedLabel = custom ? rangeLabel(from, to, user?.locale) : `${preset} window`;
  const insights = summary.data?.insights ?? [];

  const choosePreset = (next: Exclude<RangePreset, 'custom'>) => {
    setPreset(next);
    setCustom(false);
  };

  const updateCustom = (next: DateRange) => {
    setCustomRange(next);
    saveCustomRange(next);
    setCustom(true);
  };

  const runExport = async (which: ExportKind) => {
    setExporting(which);
    try {
      if (which === 'cashflow') {
        await api.downloadCashFlowCsv({ from, to, granularity });
        toast.success('Cash-flow CSV downloaded.');
      } else {
        await api.downloadTransactionsCsv({ from, to });
        toast.success('Transaction CSV downloaded.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The export could not be prepared.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Reports"
        sub={
          <>
            A calm read on <strong>{selectedLabel}</strong> · {rangeLabel(from, to, user?.locale)}. Transfers and hidden
            entries stay out of every total.
          </>
        }
        actions={
          <>
            <button type="button" className="btn" onClick={() => { void summary.refetch(); void monthly.refetch(); void spending.refetch(); }} disabled={summary.isFetching || monthly.isFetching}>
              <RefreshCw size={14} className={summary.isFetching ? 'spin' : ''} /> <span className="btn-label">Refresh</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void runExport('transactions')} disabled={exporting !== null}>
              {exporting === 'transactions' ? <Spinner label="Exporting transactions" /> : <Download size={14} />}
              <span className="btn-label">Transactions CSV</span>
            </button>
          </>
        }
      />

      <div className="report-controls">
        <div className="segmented" role="group" aria-label="Report date range">
          {RANGES.map((range) => (
            <button key={range.value} type="button" aria-pressed={!custom && preset === range.value} onClick={() => choosePreset(range.value)}>
              {range.label}
            </button>
          ))}
          <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
        </div>
        {custom ? (
          <div className="custom-range">
            <label className="sr-only" htmlFor="report-from">From</label>
            <input
              id="report-from"
              className="input"
              type="date"
              value={customRange.from}
              max={customRange.to}
              onChange={(event) => updateCustom({ ...customRange, from: event.target.value })}
            />
            <span className="faint" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="report-to">To</label>
            <input
              id="report-to"
              className="input"
              type="date"
              value={customRange.to}
              min={customRange.from}
              onChange={(event) => updateCustom({ ...customRange, to: event.target.value })}
            />
          </div>
        ) : null}
        <span className="hint" style={{ marginLeft: 'auto' }}>{granularity} aggregation · {rangeLabel(from, to, user?.locale)}</span>
      </div>

      <section className="kpi-strip" aria-label="Report totals">
        <div className="kpi">
          <div className="kpi-label"><span className="key-swatch" aria-hidden="true" /> Inflow</div>
          {summary.isLoading ? <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} /> : (
            <div className="kpi-value">{money(totals?.inflow ?? 0)}</div>
          )}
          <div className="kpi-delta">
            {summary.data && summary.data.previousFlow.inflow > 0 ? <Change current={totals?.inflow ?? 0} previous={summary.data.previousFlow.inflow} /> : 'No prior inflow'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><span className="key-swatch out" aria-hidden="true" /> Outflow</div>
          {summary.isLoading ? <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} /> : (
            <div className="kpi-value">{money(totals?.outflow ?? 0)}</div>
          )}
          <div className="kpi-delta">
            {summary.data && summary.data.previousFlow.outflow > 0 ? <Change current={totals?.outflow ?? 0} previous={summary.data.previousFlow.outflow} inverse /> : 'No prior outflow'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Net cash flow</div>
          {summary.isLoading ? <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} /> : (
            <div className={`kpi-value ${(totals?.net ?? 0) >= 0 ? 'positive' : 'negative'}`}>{money(totals?.net ?? 0, { signed: true })}</div>
          )}
          <div className="kpi-delta">Transfers and hidden entries excluded</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Savings rate</div>
          {summary.isLoading ? <div className="skeleton" style={{ height: 26, width: '62%', marginTop: 8 }} /> : (
            <div className="kpi-value">{summary.data?.savingsRate ?? 0}%</div>
          )}
          <div className="kpi-delta">Share of inflow kept in this window</div>
        </div>
      </section>

      {summary.isError ? (
        <div style={{ marginTop: 16 }}>
          <ErrorState title="The summary could not be loaded" message={summary.error instanceof Error ? summary.error.message : undefined} onRetry={() => void summary.refetch()} />
        </div>
      ) : null}

      <div className="report-grid">
        <div className="report-main">
          <section className="card card-pad" aria-labelledby="monthly-title">
            <div className="section-head">
              <div>
                <h2 id="monthly-title" className="section-title">Monthly rhythm</h2>
                <p className="card-meta" style={{ marginTop: 3 }}>Inflow against outflow, month by month. Bars share one scale.</p>
              </div>
              <StatusPill>{months.length} month{months.length === 1 ? '' : 's'}</StatusPill>
            </div>
            {monthly.isError ? (
              <ErrorState message={monthly.error instanceof Error ? monthly.error.message : undefined} onRetry={() => void monthly.refetch()} />
            ) : monthly.isLoading ? (
              <LoadingBlock lines={6} label="Loading monthly flow" />
            ) : months.length ? (
              <div className="month-list">
                {months.map((month) => (
                  <div className="month-row" key={month.month}>
                    <span className="month-label">{monthName(month.month, user?.locale)}</span>
                    <span className="month-bars" aria-hidden="true">
                      <span className="month-bar"><span style={{ width: `${Math.max(1, (month.inflow / maxMonth) * 100)}%` }} /></span>
                      <span className="month-bar out"><span style={{ width: `${Math.max(1, (month.outflow / maxMonth) * 100)}%` }} /></span>
                    </span>
                    <span className="num" style={{ textAlign: 'right' }}>{money(month.inflow, { compact: true })}</span>
                    <span className="num" style={{ textAlign: 'right' }}>{money(month.outflow, { compact: true })}</span>
                    <span className={`num ${month.net >= 0 ? 'positive' : 'negative'}`} style={{ textAlign: 'right', fontWeight: 550 }}>{money(month.net, { signed: true, compact: true })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No months in this range" copy="Add transactions, or widen the dates." />
            )}
            <div className="chart-key" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule)' }} aria-hidden="true">
              <span className="key-item"><span className="key-swatch" /> Inflow</span>
              <span className="key-item"><span className="key-swatch out" /> Outflow</span>
              <span className="hint" style={{ marginLeft: 'auto' }}>Net shown at right</span>
            </div>
          </section>

          <section className="card card-pad" aria-labelledby="spending-title">
            <div className="section-head">
              <div>
                <h2 id="spending-title" className="section-title">Where it went</h2>
                <p className="card-meta" style={{ marginTop: 3 }}>Category shares, excluding transfers and hidden entries.</p>
              </div>
              <div className="segmented" role="group" aria-label="Spending direction">
                <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>Expenses</button>
                <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>Income</button>
              </div>
            </div>
            {spending.isError ? (
              <ErrorState message={spending.error instanceof Error ? spending.error.message : undefined} onRetry={() => void spending.refetch()} />
            ) : spending.isLoading ? (
              <LoadingBlock lines={6} label="Loading category breakdown" />
            ) : categories.length ? (
              <div className="spend-list">
                {categories.map((category) => (
                  <div className="spend-row" key={category.categoryId ?? category.name}>
                    <strong><span className="cat-dot" style={{ display: 'inline-block', marginRight: 7, background: category.color }} />{category.name}</strong>
                    <span className="num">{kind === 'income' ? '+' : ''}{money(category.amountCents)}</span>
                    <span className="progress"><span style={{ width: `${Math.max(1, (category.amountCents / maxSpend) * 100)}%`, background: kind === 'expense' ? 'var(--clay)' : 'var(--accent)' }} /></span>
                    <span className="hint" style={{ gridColumn: '1 / -1' }}>{category.share}% · {category.transactionCount} transaction{category.transactionCount === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={kind === 'expense' ? 'No spending in this range' : 'No income in this range'} copy="Change the dates or add transactions to see the breakdown." />
            )}
          </section>
        </div>

        <aside className="report-side">
          <section className="card card-pad" aria-labelledby="export-title">
            <div className="section-head">
              <div>
                <h2 id="export-title" className="section-title">Take it with you</h2>
                <p className="card-meta" style={{ marginTop: 3 }}>Portable CSV files for this window.</p>
              </div>
              <FileSpreadsheet size={16} aria-hidden="true" className="faint" />
            </div>
            <div className="export-list">
              <button type="button" className="export-row" onClick={() => void runExport('cashflow')} disabled={exporting !== null}>
                <span>
                  <strong>Cash-flow CSV</strong>
                  <small>Period totals with inflow, outflow, and net</small>
                </span>
                {exporting === 'cashflow' ? <Spinner label="Exporting cash flow" /> : <Download size={15} />}
              </button>
              <button type="button" className="export-row" onClick={() => void runExport('transactions')} disabled={exporting !== null}>
                <span>
                  <strong>Transactions CSV</strong>
                  <small>Every field for the selected window</small>
                </span>
                {exporting === 'transactions' ? <Spinner label="Exporting transactions" /> : <Download size={15} />}
              </button>
            </div>
            <p className="hint" style={{ margin: '11px 0 0' }}>
              Exports contain personal data. Store them somewhere you control and delete them when done.
            </p>
          </section>

          {summary.data?.topMerchants.length ? (
            <section className="card card-pad" aria-labelledby="merchants-title">
              <div className="section-head">
                <h2 id="merchants-title" className="section-title">Top merchants</h2>
              </div>
              <div className="simple-list">
                {summary.data.topMerchants.slice(0, 5).map((merchant) => (
                  <div className="simple-row" key={merchant.merchant}>
                    <div className="simple-row-main">
                      <div className="simple-row-title">{merchant.merchant}</div>
                      <div className="simple-row-sub">{merchant.count} transaction{merchant.count === 1 ? '' : 's'}</div>
                    </div>
                    <span className="num muted" style={{ fontSize: 12 }}>{money(merchant.amountCents)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {insights.length ? (
        <section className="card card-pad" style={{ marginTop: 'var(--gap)' }} aria-labelledby="insights-title">
          <div className="section-head">
            <h2 id="insights-title" className="section-title">What the numbers say</h2>
          </div>
          <div className="insight-grid">
            {insights.map((insight, index) => (
              <div className="insight" key={insight}>
                <span className="insight-index">{String(index + 1).padStart(2, '0')}</span>
                <p>{insight}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Change({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  const change = previous === 0 ? 0 : ((current - previous) / Math.abs(previous)) * 100;
  const up = change >= 0;
  const good = inverse ? !up : up;
  return (
    <>
      {up ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
      <strong className={good ? 'positive' : 'negative'}>{Math.abs(change).toFixed(1)}%</strong>
      <span>vs previous window</span>
    </>
  );
}

function monthName(month: string, locale = 'en-US'): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date);
}
