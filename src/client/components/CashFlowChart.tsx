import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { Download, FileSpreadsheet, ImageDown, RefreshCw } from 'lucide-react';
import type { CashflowView, CashFlowPeriod, Granularity } from '../../shared/types';
import type { RangePreset } from '../../shared/dates';
import { formatPeriodLabel, formatRangeSummary } from '../../shared/dates';
import { api, downloadBlob, type CashFlowQuery } from '../lib/api';
import { rangeLabel, type DateRange } from '../lib/finance';
import { useMoney, useSession } from '../lib/session';
import { useToast } from './Toast';
import { Spinner } from './ui';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const RANGES: Array<{ value: RangePreset; label: string }> = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'YTD', label: 'YTD' },
  { value: 'custom', label: 'Custom' },
];

interface HitArea {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  periods: CashFlowPeriod[];
  granularity: Granularity;
  view: CashflowView;
  onViewChange: (view: CashflowView) => void;
  range: RangePreset;
  onRangeChange: (range: RangePreset) => void;
  customRange: DateRange;
  onCustomRangeChange: (range: DateRange) => void;
  query: CashFlowQuery;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function CashFlowChart({
  periods,
  granularity,
  view,
  onViewChange,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
  query,
  loading,
  error,
  onRetry,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hits, setHits] = useState<HitArea[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'png' | null>(null);
  const { user, theme } = useSession();
  const money = useMoney();
  const toast = useToast();
  const summaryId = useId();
  const locale = user?.locale || 'en-US';
  const currency = user?.currency || 'USD';
  const totals = useMemo(
    () =>
      periods.reduce(
        (sum, period) => ({
          inflow: sum.inflow + period.inflow,
          outflow: sum.outflow + period.outflow,
          net: sum.net + period.net,
          count: sum.count + period.transactionCount,
        }),
        { inflow: 0, outflow: 0, net: 0, count: 0 },
      ),
    [periods],
  );

  const labels = useMemo(
    () =>
      periods.map((period) =>
        formatPeriodLabel({ start: period.periodStart, end: period.periodEnd, key: period.period }, granularity, locale),
      ),
    [periods, granularity, locale],
  );

  const summary = useMemo(() => {
    if (!periods.length) return 'No cash-flow periods in this range.';
    const active = activeIndex === null ? null : periods[activeIndex];
    if (active && activeIndex !== null) {
      return `${labels[activeIndex] ?? active.period}: ${money(active.inflow)} in, ${money(active.outflow)} out, net ${money(active.net, { signed: true })} across ${active.transactionCount} transactions.`;
    }
    return `Cash flow from ${formatRangeSummary(query.from, query.to, locale)}: ${money(totals.inflow)} inflow, ${money(totals.outflow)} outflow, net ${money(totals.net, { signed: true })} across ${totals.count} transactions.`;
  }, [periods, activeIndex, labels, money, query.from, query.to, totals, locale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || 'oklch(0.52 0.095 155)';
    const clay = styles.getPropertyValue('--clay').trim() || 'oklch(0.56 0.11 45)';
    const ink = styles.getPropertyValue('--ink').trim() || '#1b231e';
    const muted = styles.getPropertyValue('--muted').trim() || '#657069';
    const grid = styles.getPropertyValue('--chart-grid').trim() || '#e4e2dc';
    const surface = styles.getPropertyValue('--surface').trim() || '#fffefa';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // If the window is not focused (or the tab is hidden), requestAnimationFrame
    // is throttled and an animated chart can remain blank. Draw the final frame
    // synchronously in that case so the chart and PNG export are always complete.
    const animate = !reduced && document.visibilityState === 'visible' && document.hasFocus();
    const isBar = view === 'bar';
    const inflowData = periods.map((period) => period.inflow / 100);
    const outflowData = periods.map((period) => period.outflow / 100);
    const compact = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });

    const config: ChartConfiguration = {
      type: view === 'bar' ? 'bar' : 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Inflow',
            data: inflowData,
            backgroundColor: isBar ? accent : view === 'area' ? (theme === 'dark' ? 'oklch(0.77 0.12 155 / 0.14)' : 'oklch(0.52 0.095 155 / 0.10)') : 'transparent',
            borderColor: accent,
            borderWidth: isBar ? 0 : 2,
            borderRadius: isBar ? 2 : undefined,
            maxBarThickness: 24,
            fill: view === 'area',
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: accent,
            pointBorderColor: surface,
            pointBorderWidth: 2,
          },
          {
            label: 'Outflow',
            data: outflowData,
            backgroundColor: isBar ? clay : view === 'area' ? (theme === 'dark' ? 'oklch(0.75 0.11 55 / 0.12)' : 'oklch(0.56 0.11 45 / 0.08)') : 'transparent',
            borderColor: clay,
            borderWidth: isBar ? 0 : 2,
            borderRadius: isBar ? 2 : undefined,
            maxBarThickness: 24,
            fill: view === 'area',
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: clay,
            pointBorderColor: surface,
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animate ? { duration: 320, easing: 'easeOutQuart' } : false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: ink,
            titleColor: surface,
            bodyColor: surface,
            borderColor: ink,
            borderWidth: 0,
            padding: 10,
            cornerRadius: 5,
            titleFont: { family: 'Inter Variable, Inter, system-ui, sans-serif', size: 11, weight: 600 },
            bodyFont: { family: 'Inter Variable, Inter, system-ui, sans-serif', size: 11 },
            displayColors: true,
            boxWidth: 7,
            boxHeight: 7,
            boxPadding: 4,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (item) => `${item.dataset.label ?? ''}  ${money(Math.round((item.parsed.y ?? 0) * 100))}`,
              afterBody: (items) => {
                const period = periods[items[0]?.dataIndex ?? -1];
                if (!period) return '';
                const lines = [`${period.transactionCount} transaction${period.transactionCount === 1 ? '' : 's'}`];
                lines.push(`Net ${money(period.net, { signed: true })}`);
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: muted,
              font: { family: 'Inter Variable, Inter, system-ui, sans-serif', size: 10.5 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: granularity === 'day' ? 14 : 12,
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: grid, drawTicks: false },
            border: { display: false },
            ticks: {
              color: muted,
              padding: 8,
              font: { family: 'Inter Variable, Inter, system-ui, sans-serif', size: 10.5 },
              callback: (value) => compact.format(Number(value)),
            },
          },
        },
      },
    };

    const chart = new Chart(canvas, config);
    chartRef.current = chart;

    const measure = () => {
      const meta0 = chart.getDatasetMeta(0);
      const meta1 = chart.getDatasetMeta(1);
      const area = chart.chartArea;
      if (!area) return;
      const next: HitArea[] = [];
      for (let index = 0; index < periods.length; index += 1) {
        const first = meta0.data[index] as { x: number; width?: number } | undefined;
        const second = meta1.data[index] as { x: number; width?: number } | undefined;
        if (!first) continue;
        const firstWidth = typeof first.width === 'number' ? first.width : 0;
        const secondWidth = typeof second?.width === 'number' ? second.width : 0;
        if (view === 'bar' && firstWidth > 0) {
          const left = Math.min(first.x - firstWidth / 2, second ? second.x - secondWidth / 2 : first.x - firstWidth / 2);
          const right = Math.max(first.x + firstWidth / 2, second ? second.x + secondWidth / 2 : first.x + firstWidth / 2);
          next.push({ index, x: left, y: area.top, width: Math.max(14, right - left), height: area.bottom - area.top });
        } else {
          next.push({ index, x: first.x - 12, y: area.top, width: 24, height: area.bottom - area.top });
        }
      }
      setHits(next);
    };

    // Measure immediately so keyboard hit areas exist even when the tab is
    // backgrounded and requestAnimationFrame is throttled. Re-measure after the
    // first layout, after the intro animation, and on resize.
    measure();
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(measure));
    const settle = window.setTimeout(measure, 380);
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(measure);
    });
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer.disconnect();
      chart.destroy();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [periods, labels, view, theme, granularity, money, locale, currency]);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= periods.length) setActiveIndex(null);
  }, [activeIndex, periods.length]);

  const exportCsv = async () => {
    setExporting('csv');
    try {
      await api.downloadCashFlowCsv(query);
      toast.success('Cash-flow CSV exported with the TALLY wordmark.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'CSV export failed.');
    } finally {
      setExporting(null);
    }
  };

  const exportPng = async () => {
    const chart = chartRef.current;
    if (!chart) return;
    setExporting('png');
    try {
      // Force a final, animation-free render so an export taken immediately
      // after load (or while the window is backgrounded) is never blank.
      chart.update('none');
      const source = chart.canvas;
      const width = 1600;
      const height = 1000;
      const output = document.createElement('canvas');
      output.width = width;
      output.height = height;
      const context = output.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      const styles = getComputedStyle(document.documentElement);
      const surface = styles.getPropertyValue('--surface').trim() || '#fffefa';
      const ink = styles.getPropertyValue('--ink').trim() || '#1b231e';
      const muted = styles.getPropertyValue('--muted').trim() || '#657069';
      const accent = styles.getPropertyValue('--accent').trim() || '#4e7a60';
      const rule = styles.getPropertyValue('--border').trim() || '#dedbd2';
      context.fillStyle = surface;
      context.fillRect(0, 0, width, height);
      context.fillStyle = ink;
      context.font = '600 22px "Inter Variable", Inter, system-ui, sans-serif';
      context.fillText('TALLY', 64, 70);
      context.fillStyle = accent;
      for (let index = 0; index < 4; index += 1) {
        context.fillRect(145 + index * 8, 47, 2, 26);
      }
      context.beginPath();
      context.moveTo(144, 74);
      context.lineTo(178, 46);
      context.strokeStyle = accent;
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = ink;
      context.font = '500 30px "Iowan Old Style", "Palatino Linotype", Georgia, serif';
      context.fillText('Inflow vs. outflow', 64, 138);
      context.font = '400 14px "Inter Variable", Inter, system-ui, sans-serif';
      context.fillStyle = muted;
      context.fillText(`${formatRangeSummary(query.from, query.to, locale)}  ·  ${granularity} view  ·  ${currency}`, 64, 168);
      context.font = '400 13px "Inter Variable", Inter, system-ui, sans-serif';
      context.textAlign = 'right';
      context.fillText(`Net ${money(totals.net, { signed: true })}  ·  ${totals.count} transactions`, width - 64, 70);
      context.textAlign = 'left';
      context.drawImage(source, 64, 206, width - 128, 646);
      context.strokeStyle = rule;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(64, 890);
      context.lineTo(width - 64, 890);
      context.stroke();
      context.fillStyle = muted;
      context.font = '400 12px "Inter Variable", Inter, system-ui, sans-serif';
      context.fillText(`Inflow ${money(totals.inflow)}`, 64, 925);
      context.fillText(`Outflow ${money(totals.outflow)}`, 260, 925);
      context.fillText('Excludes transfers and hidden transactions', 456, 925);
      context.textAlign = 'right';
      context.fillText(`Every dollar, accounted for.  ·  ${new Date().toLocaleDateString(locale)}`, width - 64, 925);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG export failed.');
      downloadBlob(blob, `tally-cash-flow-${query.from}-to-${query.to}.png`);
      toast.success('PNG export saved with the TALLY wordmark.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'PNG export failed.');
    } finally {
      setExporting(null);
    }
  };

  const focusHit = (index: number) => {
    const button = hitRefs.current[index];
    if (button) button.focus();
  };

  const onHitKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusHit((index + 1) % periods.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusHit((index - 1 + periods.length) % periods.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusHit(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusHit(periods.length - 1);
    }
  };

  const active = activeIndex === null ? null : periods[activeIndex];
  const allZero = periods.length > 0 && periods.every((period) => period.transactionCount === 0);
  const canExport = !loading && !error && periods.length > 0;

  return (
    <section className="card chart-card" aria-labelledby="cashflow-title">
      <div className="chart-head">
        <div>
          <div className="chart-title-row">
            <h2 id="cashflow-title" className="card-title">Inflow vs. outflow</h2>
            <span className="badge badge-accent">Transfers excluded</span>
          </div>
          <p className="card-meta">Money in and out, excluding transfers and transactions hidden from reports.</p>
        </div>
        <div className="chart-tools">
          <div className="segmented" role="group" aria-label="Chart type">
            <button type="button" aria-pressed={view === 'bar'} onClick={() => onViewChange('bar')}>Bars</button>
            <button type="button" aria-pressed={view === 'area'} onClick={() => onViewChange('area')}>Area</button>
            <button type="button" aria-pressed={view === 'line'} onClick={() => onViewChange('line')}>Line</button>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void exportCsv()} disabled={!canExport || exporting !== null} title="Export CSV">
            {exporting === 'csv' ? <Spinner label="Exporting CSV" /> : <FileSpreadsheet size={14} />}
            <span>CSV</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void exportPng()} disabled={!canExport || exporting !== null} title="Export PNG">
            {exporting === 'png' ? <Spinner label="Exporting PNG" /> : <ImageDown size={14} />}
            <span>PNG</span>
          </button>
        </div>
      </div>

      <div className="chart-controls">
        <div className="range-wrap">
          <div className="segmented" role="group" aria-label="Date range">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => onRangeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {range === 'custom' ? (
            <div className="custom-range">
              <label className="sr-only" htmlFor="cashflow-from">From</label>
              <input
                id="cashflow-from"
                className="input"
                type="date"
                value={customRange.from}
                max={customRange.to}
                onChange={(event) => onCustomRangeChange({ ...customRange, from: event.target.value })}
              />
              <span className="faint" aria-hidden="true">–</span>
              <label className="sr-only" htmlFor="cashflow-to">To</label>
              <input
                id="cashflow-to"
                className="input"
                type="date"
                value={customRange.to}
                min={customRange.from}
                onChange={(event) => onCustomRangeChange({ ...customRange, to: event.target.value })}
              />
            </div>
          ) : null}
        </div>
        <span className="hint" style={{ marginLeft: 'auto' }}>{rangeLabel(query.from, query.to, locale)}</span>
      </div>

      <div className="chart-area">
        {loading ? (
          <div className="chart-canvas-wrap" role="status" aria-busy="true" aria-label="Loading cash-flow chart">
            <div className="loading-block" style={{ paddingTop: 54 }}>
              <div className="skeleton" style={{ height: 18, width: '30%' }} />
              <div className="skeleton" style={{ height: 132 }} />
              <div className="skeleton" style={{ height: 12, width: '72%' }} />
            </div>
          </div>
        ) : error ? (
          <div className="chart-canvas-wrap" style={{ display: 'grid', placeItems: 'center' }}>
            <div className="error-box" style={{ maxWidth: 380 }} role="alert">
              <strong>Cash flow is unavailable</strong>
              <div>{error.message || 'The report could not be built right now.'}</div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={onRetry}>
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chart-canvas-wrap">
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={summary}
                aria-describedby={summaryId}
              />
              {hits.map((hit) => (
                <button
                  key={hit.index}
                  ref={(element) => {
                    hitRefs.current[hit.index] = element;
                  }}
                  type="button"
                  className="bar-hit"
                  style={{ left: hit.x, top: hit.y, width: hit.width, height: hit.height }}
                  aria-label={`${labels[hit.index]}: ${money(periods[hit.index]?.inflow ?? 0)} inflow, ${money(periods[hit.index]?.outflow ?? 0)} outflow, net ${money(periods[hit.index]?.net ?? 0, { signed: true })}, ${periods[hit.index]?.transactionCount ?? 0} transactions. Use arrow keys to move between periods.`}
                  onFocus={() => setActiveIndex(hit.index)}
                  onBlur={() => setActiveIndex(null)}
                  onKeyDown={(event) => onHitKeyDown(event, hit.index)}
                />
              ))}
              {allZero ? (
                <div className="chart-empty">
                  <div className="chart-empty-inner">
                    <strong>No money moved in this window</strong>
                    Add a transaction and the bars will fill in. Transfers and excluded entries stay out of this view.
                  </div>
                </div>
              ) : null}
              {active ? (
                <div className="chart-readout" role="status" aria-live="polite">
                  <span>{labels[activeIndex ?? 0]}</span>
                  <span className="faint" aria-hidden="true">|</span>
                  <span>{money(active.inflow, { compact: true })} in</span>
                  <span>{money(active.outflow, { compact: true })} out</span>
                </div>
              ) : null}
            </div>
            <p id={summaryId} className="sr-only">{summary}</p>
          </>
        )}
      </div>

      <div className="chart-footer">
        <div className="chart-key" aria-hidden="true">
          <span className="key-item"><span className="key-swatch" /> Inflow</span>
          <span className="key-item"><span className="key-swatch out" /> Outflow</span>
        </div>
        <span className="chart-summary">
          {totals.count} transactions · Net {money(totals.net, { signed: true })}
        </span>
      </div>

      <details className="chart-details">
        <summary>
          <Download size={13} /> Accessible data table
        </summary>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="sr-only">Inflow and outflow by period, excluding transfers and hidden transactions.</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">Inflow</th>
                <th scope="col" className="num">Outflow</th>
                <th scope="col" className="num">Net</th>
                <th scope="col" className="num">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {periods.length === 0 ? (
                <tr><td colSpan={5} className="muted">No periods in this range.</td></tr>
              ) : (
                periods.map((period, index) => (
                  <tr key={period.period}>
                    <th scope="row" style={{ fontWeight: 500, height: 38 }}>{labels[index]}</th>
                    <td className="num positive">{money(period.inflow)}</td>
                    <td className="num">{money(period.outflow)}</td>
                    <td className={`num ${period.net >= 0 ? 'positive' : 'negative'}`}>{money(period.net, { signed: true })}</td>
                    <td className="num">{period.transactionCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
