import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Chart } from 'chart.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashFlowPeriod, CashflowView, Granularity } from '../../src/shared/types';
import type { RangePreset } from '../../src/shared/dates';
import { CashFlowChart } from '../../src/client/components/CashFlowChart';

const mocks = vi.hoisted(() => ({
  downloadCashFlowCsv: vi.fn(),
  downloadBlob: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('chart.js', () => {
  class MockChart {
    static instances: MockChart[] = [];
    static register = vi.fn();
    canvas: HTMLCanvasElement;
    config: { type: string; data: { labels: string[]; datasets: Array<{ label: string }> }; options: unknown };
    chartArea = { top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 };
    update = vi.fn();
    destroy = vi.fn();
    constructor(canvas: HTMLCanvasElement, config: MockChart['config']) {
      this.canvas = canvas;
      this.config = config;
      MockChart.instances.push(this);
    }
    getDatasetMeta() {
      return {
        data: this.config.data.labels.map((_, index) => ({ x: 20 + index * 40, width: 14 })),
      };
    }
  }
  return {
    Chart: MockChart,
    BarController: class {},
    BarElement: class {},
    LineController: class {},
    LineElement: class {},
    PointElement: class {},
    CategoryScale: class {},
    LinearScale: class {},
    Tooltip: class {},
    Legend: class {},
    Filler: class {},
  };
});

vi.mock('@client/lib/api', () => ({
  api: { downloadCashFlowCsv: mocks.downloadCashFlowCsv },
  downloadBlob: mocks.downloadBlob,
}));

vi.mock('@client/lib/session', async () => {
  const { formatMoney } = await import('../../src/shared/money');
  const money = (cents: number, options: Record<string, unknown> = {}) =>
    formatMoney(cents, 'NGN', 'en-NG', options);
  return {
    useSession: () => ({ user: { currency: 'NGN', locale: 'en-NG' }, theme: 'light' }),
    useMoney: () => money,
  };
});

vi.mock('@client/components/Toast', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

const periods: CashFlowPeriod[] = [
  { period: '2026-05', periodStart: '2026-05-01', periodEnd: '2026-05-31', inflow: 500_000, outflow: 100_000, net: 400_000, transactionCount: 2 },
  { period: '2026-06', periodStart: '2026-06-01', periodEnd: '2026-06-30', inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
  { period: '2026-07', periodStart: '2026-07-01', periodEnd: '2026-07-31', inflow: 250_000, outflow: 50_000, net: 200_000, transactionCount: 1 },
];

const query = { from: '2026-05-01', to: '2026-07-31', granularity: 'month' as Granularity };

function renderChart(overrides: Partial<Parameters<typeof CashFlowChart>[0]> = {}) {
  const props = {
    periods,
    granularity: 'month' as Granularity,
    view: 'bar' as CashflowView,
    onViewChange: vi.fn(),
    range: '3M' as RangePreset,
    onRangeChange: vi.fn(),
    customRange: { from: '2026-05-01', to: '2026-07-31' },
    onCustomRangeChange: vi.fn(),
    query,
    loading: false,
    error: null as Error | null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const view = render(<CashFlowChart {...props} />);
  return { ...view, props };
}

async function waitForHits(count = periods.length) {
  await waitFor(() => {
    expect(document.querySelectorAll('.bar-hit')).toHaveLength(count);
  });
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.bar-hit'));
}

beforeEach(() => {
  vi.clearAllMocks();
  (Chart as unknown as { instances: unknown[] }).instances.length = 0;
  mocks.downloadCashFlowCsv.mockResolvedValue(undefined);
});

describe('cash-flow chart acceptance: controls and views', () => {
  it('renders grouped inflow/outflow bars by default and exposes view and range controls', () => {
    const { props } = renderChart();
    const chart = (Chart as unknown as { instances: Array<{ config: { type: string; data: { datasets: Array<{ label: string }> } } }> }).instances[0]!;
    expect(chart.config.type).toBe('bar');
    expect(chart.config.data.datasets.map((dataset) => dataset.label)).toEqual(['Inflow', 'Outflow']);

    const viewGroup = screen.getByRole('group', { name: 'Chart type' });
    const bars = screen.getByRole('button', { name: 'Bars' });
    const area = screen.getByRole('button', { name: 'Area' });
    expect(viewGroup).toBeInTheDocument();
    expect(bars).toHaveAttribute('aria-pressed', 'true');
    expect(area).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(area);
    expect(props.onViewChange).toHaveBeenCalledWith('area');

    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(props.onRangeChange).toHaveBeenCalledWith('1M');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(props.onRangeChange).toHaveBeenCalledWith('custom');
  });

  it('shows custom date inputs and reports edited bounds', () => {
    const { props } = renderChart({ range: 'custom' });
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toHaveValue('2026-05-01');
    expect(to).toHaveValue('2026-07-31');
    fireEvent.change(from, { target: { value: '2026-04-01' } });
    expect(props.onCustomRangeChange).toHaveBeenCalledWith({ from: '2026-04-01', to: '2026-07-31' });
  });
});

describe('cash-flow chart acceptance: accessibility', () => {
  it('provides an accessible summary, keyboard bars, live readout, and a data table', async () => {
    renderChart();
    const canvas = screen.getByRole('img', { name: /cash flow from/i });
    expect(canvas).toHaveAttribute('aria-describedby');
    expect(canvas.getAttribute('aria-label')).toMatch(/inflow/i);
    expect(canvas.getAttribute('aria-label')).toMatch(/across 3 transactions/);

    const hits = await waitForHits();
    expect(hits[0]).toHaveAttribute('aria-label', expect.stringContaining('Use arrow keys'));

    fireEvent.focusIn(hits[0]!);
    expect(screen.getByRole('status')).toHaveTextContent('May 2026');
    fireEvent.keyDown(hits[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(hits[1]);
    fireEvent.keyDown(hits[1]!, { key: 'End' });
    expect(document.activeElement).toBe(hits[2]);
    fireEvent.keyDown(hits[2]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(hits[0]);
    fireEvent.keyDown(hits[0]!, { key: 'Home' });
    expect(document.activeElement).toBe(hits[0]);

    expect(screen.getByText('Accessible data table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Inflow' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'May 2026' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Net' })).toBeInTheDocument();
  });
});

describe('cash-flow chart acceptance: states', () => {
  it('shows a labelled loading status and disables exports', () => {
    renderChart({ loading: true, periods: [] });
    expect(screen.getByRole('status', { name: 'Loading cash-flow chart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /PNG/ })).toBeDisabled();
  });

  it('shows a recoverable error state', () => {
    const { props } = renderChart({ error: new Error('Network is down'), periods: [] });
    expect(screen.getByRole('alert')).toHaveTextContent('Cash flow is unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Network is down');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('distinguishes an empty range from a range with no activity', () => {
    const { rerender } = renderChart({ periods: [] });
    expect(screen.getByText('No periods in this range.')).toBeInTheDocument();

    rerender(
      <CashFlowChart
        periods={periods.map((period) => ({ ...period, inflow: 0, outflow: 0, net: 0, transactionCount: 0 }))}
        granularity="month"
        view="bar"
        onViewChange={vi.fn()}
        range="3M"
        onRangeChange={vi.fn()}
        customRange={{ from: '2026-05-01', to: '2026-07-31' }}
        onCustomRangeChange={vi.fn()}
        query={query}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('No money moved in this window')).toBeInTheDocument();
  });
});

describe('cash-flow chart acceptance: exports', () => {
  it('exports CSV with the current query and confirms the TALLY wordmark', async () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() => {
      expect(mocks.downloadCashFlowCsv).toHaveBeenCalledWith(query);
      expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/TALLY wordmark/));
    });
  });

  it('renders a final frame and exports a named PNG with the TALLY wordmark', async () => {
    renderChart();
    const chart = (Chart as unknown as { instances: Array<{ update: ReturnType<typeof vi.fn> }> }).instances[0]!;
    fireEvent.click(screen.getByRole('button', { name: /PNG/ }));
    await waitFor(() => {
      expect(chart.update).toHaveBeenCalledWith('none');
      expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'tally-cash-flow-2026-05-01-to-2026-07-31.png');
      expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/TALLY wordmark/));
    });
  });
});
