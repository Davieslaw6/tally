/**
 * Single source of truth for the currencies TALLY presents. The five primary
 * currencies (NGN, USD, EUR, CAD, GBP) are deliberately first: they are the
 * defaults in every picker, API response, and validation path. Additional
 * currencies are supported without changing the application context.
 */
export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const PRIMARY_CURRENCY_CODES = ['NGN', 'USD', 'EUR', 'CAD', 'GBP'] as const;
export type PrimaryCurrencyCode = (typeof PRIMARY_CURRENCY_CODES)[number];

export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  { code: 'NGN', name: 'Nigerian naira', symbol: '₦' },
  { code: 'USD', name: 'US dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'CAD', name: 'Canadian dollar', symbol: 'CA$' },
  { code: 'GBP', name: 'British pound', symbol: '£' },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$' },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥' },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF' },
  { code: 'CNY', name: 'Chinese yuan', symbol: 'CN¥' },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: 'HK$' },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$' },
  { code: 'INR', name: 'Indian rupee', symbol: '₹' },
  { code: 'PKR', name: 'Pakistani rupee', symbol: '₨' },
  { code: 'BDT', name: 'Bangladeshi taka', symbol: '৳' },
  { code: 'AED', name: 'UAE dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi riyal', symbol: '﷼' },
  { code: 'ILS', name: 'Israeli new shekel', symbol: '₪' },
  { code: 'ZAR', name: 'South African rand', symbol: 'R' },
  { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian cedi', symbol: '₵' },
  { code: 'EGP', name: 'Egyptian pound', symbol: 'E£' },
  { code: 'MAD', name: 'Moroccan dirham', symbol: 'MAD' },
  { code: 'UGX', name: 'Ugandan shilling', symbol: 'USh' },
  { code: 'TZS', name: 'Tanzanian shilling', symbol: 'TSh' },
  { code: 'RWF', name: 'Rwandan franc', symbol: 'FRw' },
  { code: 'ZMW', name: 'Zambian kwacha', symbol: 'ZK' },
  { code: 'BWP', name: 'Botswana pula', symbol: 'P' },
  { code: 'MZN', name: 'Mozambican metical', symbol: 'MT' },
  { code: 'XOF', name: 'West African CFA franc', symbol: 'CFA' },
  { code: 'XAF', name: 'Central African CFA franc', symbol: 'FCFA' },
  { code: 'SEK', name: 'Swedish krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish krone', symbol: 'kr' },
  { code: 'PLN', name: 'Polish złoty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech koruna', symbol: 'Kč' },
  { code: 'HUF', name: 'Hungarian forint', symbol: 'Ft' },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺' },
  { code: 'BRL', name: 'Brazilian real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican peso', symbol: 'MX$' },
  { code: 'KRW', name: 'South Korean won', symbol: '₩' },
  { code: 'THB', name: 'Thai baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian rupiah', symbol: 'Rp' },
  { code: 'MYR', name: 'Malaysian ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine peso', symbol: '₱' },
  { code: 'VND', name: 'Vietnamese đồng', symbol: '₫' },
];

export const CURRENCY_CODES: readonly string[] = CURRENCY_OPTIONS.map((option) => option.code);
const SUPPORTED = new Set(CURRENCY_CODES);

export function isSupportedCurrency(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED.has(value.toUpperCase());
}

/** Return a supported upper-case ISO code, or the supplied fallback. */
export function normalizeCurrency(value: unknown, fallback = 'USD'): string {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return SUPPORTED.has(candidate) ? candidate : fallback;
}

export function currencyOption(code: string): CurrencyOption | undefined {
  const normalized = normalizeCurrency(code, '');
  return CURRENCY_OPTIONS.find((option) => option.code === normalized);
}

export function currencyName(code: string): string {
  return currencyOption(code)?.name ?? 'Currency';
}

export function currencySymbol(code: string): string {
  return currencyOption(code)?.symbol ?? normalizeCurrency(code, 'USD');
}

export function currencyLabel(code: string): string {
  const option = currencyOption(code);
  return option ? `${option.code} - ${option.name} (${option.symbol})` : code;
}

export function primaryCurrencies(): readonly CurrencyOption[] {
  return PRIMARY_CURRENCY_CODES.map((code) => CURRENCY_OPTIONS.find((option) => option.code === code)!);
}

export function otherCurrencies(): readonly CurrencyOption[] {
  return CURRENCY_OPTIONS.filter((option) => !(PRIMARY_CURRENCY_CODES as readonly string[]).includes(option.code));
}
