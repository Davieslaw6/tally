import { addMonths, autoGranularity, presetRange, startOfMonth, todayInTimezone, type RangePreset } from '../../shared/dates';
import { centsToDecimal, parseAmountToCents } from '../../shared/money';

export { autoGranularity };

export interface DateRange {
  from: string;
  to: string;
}

export function todayISO(timezone = 'UTC'): string {
  return todayInTimezone(timezone || 'UTC');
}

export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, timezone = 'UTC'): DateRange {
  return presetRange(preset, todayISO(timezone));
}

export function rangeLabel(from: string, to: string, locale = 'en-US'): string {
  if (!from || !to) return '';
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`;
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function previousRange(from: string, to: string): DateRange {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(start.getTime() - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (span - 1) * 86_400_000);
  return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

export function currentMonth(timezone = 'UTC'): string {
  return todayISO(timezone).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  return addMonths(`${month}-01`, delta).slice(0, 7);
}

export function monthBounds(month: string): DateRange {
  const from = `${month}-01`;
  const next = addMonths(from, 1);
  return { from, to: new Date(new Date(`${next}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) };
}

export function monthLabel(month: string, locale = 'en-US'): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function moneyInputToCents(input: string): number {
  try {
    return parseAmountToCents(input);
  } catch {
    // Form fields are parsed on every keystroke; an incomplete value is not fatal.
    return Number.NaN;
  }
}

export function centsToInput(cents: number): string {
  return centsToDecimal(cents);
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

export function monthStart(month: string): string {
  return startOfMonth(`${month}-01`);
}

const CUSTOM_RANGE_KEY = 'tally:custom-range';

export function readCustomRange(timezone = 'UTC'): DateRange {
  try {
    const raw = localStorage.getItem(CUSTOM_RANGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DateRange>;
      if (typeof parsed.from === 'string' && typeof parsed.to === 'string' && parsed.from <= parsed.to) {
        return { from: parsed.from, to: parsed.to };
      }
    }
  } catch {
    // fall through to the preset
  }
  return presetRange('6M', todayISO(timezone));
}

export function saveCustomRange(range: DateRange): void {
  try {
    localStorage.setItem(CUSTOM_RANGE_KEY, JSON.stringify(range));
  } catch {
    // storage is a convenience, not a requirement
  }
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'T';
}

export function humanizeKey(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
