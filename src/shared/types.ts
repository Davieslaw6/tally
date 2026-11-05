export type ThemeName = 'dark' | 'light' | 'contrast';
export type Density = 'comfortable' | 'compact';
export type CashflowView = 'bar' | 'area' | 'line';
export type Granularity = 'day' | 'week' | 'month';

export interface PublicUser {
  id: string;
  displayName: string | null;
  currency: string;
  locale: string;
  timezone: string;
  createdAt: string;
}

export interface Settings {
  theme: ThemeName;
  density: Density;
  navCollapsed: boolean;
  chartView: CashflowView;
  chartRange: string;
  onboardingCompleted: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'investment';
  institution: string | null;
  currency: string;
  openingBalanceCents: number;
  currentBalanceCents: number;
  color: string;
  archived: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  color: string;
  icon: string;
  isSystem: boolean;
  archived: boolean;
}

export interface Split {
  id: string;
  categoryId: string;
  categoryName: string | null;
  amountCents: number;
  note: string | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  amountCents: number;
  date: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  tags: string[];
  isTransfer: boolean;
  transferGroupId: string | null;
  isSplit: boolean;
  excludedFromReports: boolean;
  splits?: Split[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The cash-flow endpoint returns a bare array, matching the API contract.
 * `period` is a stable ISO key (YYYY-MM, the Monday of a week, or YYYY-MM-DD).
 */
export interface CashFlowPeriod {
  period: string;
  periodStart: string;
  periodEnd: string;
  inflow: number;
  outflow: number;
  net: number;
  transactionCount: number;
}

export interface CashFlowTotals {
  inflow: number;
  outflow: number;
  net: number;
  transactionCount: number;
}

export interface Budget {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  month: string;
  amountCents: number;
  spentCents: number;
  alertThreshold: number;
}

export interface Goal {
  id: string;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  color: string;
  createdAt: string;
}

export interface DashboardSummary {
  currentBalanceCents: number;
  openingBalanceCents: number;
  netWorthCents: number;
  period: { from: string; to: string };
  flow: { inflow: number; outflow: number; net: number };
  previousFlow: { inflow: number; outflow: number; net: number };
  savingsRate: number;
  topCategories: Array<{ categoryId: string | null; name: string; color: string; amountCents: number }>;
  topMerchants: Array<{ merchant: string; amountCents: number; count: number }>;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export interface Paged<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
