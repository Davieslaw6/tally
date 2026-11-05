export type ISODate = string;

const DAY_MS = 86_400_000;

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseISODate(value: string): Date {
  if (!isValidISODate(value)) throw new Error(`Invalid date: ${value}`);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function toISODate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function addDays(value: string, days: number): string {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

export function addMonths(value: string, months: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day!, lastDay));
  return toISODate(target);
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  return toISODate(new Date(Date.UTC(y!, m!, 0)));
}

export function monthKey(value: string): string {
  return value.slice(0, 7);
}

/** Monday-based week start, independent of server timezone. */
export function startOfWeek(value: string): string {
  const date = parseISODate(value);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(value, diff);
}

export function compareISODate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function eachDay(from: string, to: string): string[] {
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) return [];
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    days.push(cursor);
    if (days.length > 3700) break;
  }
  return days;
}

export function todayInTimezone(timeZone = 'UTC', now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return toISODate(now);
  }
}

export function startOfYear(value: string): string {
  return `${value.slice(0, 4)}-01-01`;
}

export type RangePreset = '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'custom';
export type Granularity = 'day' | 'week' | 'month';

export interface DateRange {
  from: string;
  to: string;
}

/** Inclusive calendar-month window ending in the month that contains `today`. */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  const to = today;
  if (preset === 'YTD') return { from: startOfYear(today), to };
  const months = preset === '1M' ? 0 : preset === '3M' ? 2 : preset === '6M' ? 5 : 11;
  return { from: startOfMonth(addMonths(startOfMonth(today), -months)), to };
}

export function autoGranularity(from: string, to: string): Granularity {
  const days = Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS) + 1;
  if (days <= 32) return 'day';
  if (days <= 93) return 'week';
  return 'month';
}

export interface Period {
  start: string;
  end: string;
  key: string;
}

export function periodsBetween(from: string, to: string, granularity: Granularity): Period[] {
  if (from > to) return [];
  const periods: Period[] = [];
  if (granularity === 'month') {
    let cursor = startOfMonth(from);
    while (cursor <= to) {
      const monthEnd = endOfMonth(cursor);
      const start = cursor < from ? from : cursor;
      const end = monthEnd > to ? to : monthEnd;
      periods.push({ start, end, key: monthKey(cursor) });
      cursor = addMonths(cursor, 1);
    }
    return periods;
  }
  if (granularity === 'week') {
    let cursor = startOfWeek(from);
    while (cursor <= to) {
      const end = addDays(cursor, 6);
      periods.push({ start: cursor < from ? from : cursor, end: end > to ? to : end, key: cursor });
      cursor = addDays(cursor, 7);
    }
    return periods;
  }
  let cursor = from;
  while (cursor <= to) {
    periods.push({ start: cursor, end: cursor, key: cursor });
    cursor = addDays(cursor, 1);
  }
  return periods;
}

export function periodKeyForDate(date: string, granularity: Granularity): string {
  if (granularity === 'month') return monthKey(date);
  if (granularity === 'week') return startOfWeek(date);
  return date;
}

export function formatPeriodLabel(period: Period, granularity: Granularity, locale = 'en-US'): string {
  const date = parseISODate(period.start);
  if (granularity === 'month') {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  if (granularity === 'day') {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  }
  const end = parseISODate(period.end);
  const startLabel = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  const endLabel = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(end);
  return `${startLabel} – ${endLabel}`;
}

export function formatLongDate(value: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseISODate(value));
}

export function formatRangeSummary(from: string, to: string, locale = 'en-US'): string {
  const f = parseISODate(from);
  const t = parseISODate(to);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  return `${fmt(f)} – ${fmt(t)}`;
}

export function previousPeriod(from: string, to: string): DateRange {
  const span = Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS) + 1;
  const previousTo = addDays(from, -1);
  return { from: addDays(previousTo, -(span - 1)), to: previousTo };
}

export function nextOccurrence(date: string, frequency: string): string {
  switch (frequency) {
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'monthly':
      return addMonths(date, 1);
    case 'quarterly':
      return addMonths(date, 3);
    case 'yearly':
      return addMonths(date, 12);
    default:
      return addMonths(date, 1);
  }
}

export function minDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

export function maxDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}
