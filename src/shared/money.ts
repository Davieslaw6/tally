import { normalizeCurrency } from './currencies';
import { normalizeLocale } from './locale';

const CENTS_PER_UNIT = 100;

/**
 * Parse a human-entered amount into signed integer cents without floating-point
 * rounding. Accepts ₦1,234.56, $1,234.56, CA$12.50, "NGN 2,000", (45.20),
 * -12, 12.5, 12.567, and Unicode minus.
 */
export function parseAmountToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid amount');
    input = input.toString();
  }
  let value = input.trim().replace(/\u2212/g, '-');
  if (!value) throw new Error('Invalid amount');
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  // Drop a leading currency code or country prefix ("NGN 1,000", "US$1,000",
  // "CA$12.50") before removing the symbol itself.
  value = value.replace(/^[A-Za-z]{2,3}(?=\p{Sc}|\d)/u, '');
  value = value.replace(/\p{Sc}/gu, '').replace(/[,\s']/g, '');
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (!/^\d+(\.\d*)?$/.test(value)) throw new Error('Invalid amount');
  const [wholeRaw, fractionRaw = ''] = value.split('.');
  if (fractionRaw.length > 2 && /[1-9]/.test(fractionRaw.slice(2))) {
    throw new Error('Amount supports at most 2 decimal places');
  }
  const whole = Number.parseInt(wholeRaw || '0', 10);
  const fraction = Number.parseInt((fractionRaw + '00').slice(0, 2), 10);
  if (!Number.isSafeInteger(whole) || whole > 9_000_000_000_000) throw new Error('Amount is too large');
  const cents = whole * CENTS_PER_UNIT + fraction;
  return negative ? -cents : cents;
}

export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function formatMoney(
  cents: number,
  currency = 'USD',
  locale = 'en-US',
  options: { signed?: boolean; absolute?: boolean; compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const amount = (options.absolute ? Math.abs(cents) : cents) / 100;
  const maximumFractionDigits = Math.min(20, Math.max(0, options.maximumFractionDigits ?? 2));
  return new Intl.NumberFormat(normalizeLocale(locale), {
    style: 'currency',
    currency: normalizeCurrency(currency),
    signDisplay: options.signed ? 'exceptZero' : 'auto',
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits,
    minimumFractionDigits: options.compact ? 0 : Math.min(2, maximumFractionDigits),
  }).format(amount);
}

export function formatNumber(value: number, locale = 'en-US', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number, locale = 'en-US', digits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function inflowOf(cents: number): number {
  return Math.max(cents, 0);
}

export function outflowOf(cents: number): number {
  return Math.max(-cents, 0);
}

export function netOf(cents: number): number {
  return cents;
}

export function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
