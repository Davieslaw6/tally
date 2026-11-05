import type {
  Account,
  ApiErrorBody,
  Budget,
  CashFlowPeriod,
  Category,
  DashboardSummary,
  Goal,
  Paged,
  PublicUser,
  Settings,
  Transaction,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const message =
    body?.message || (response.status === 401 ? 'Your session has ended. Enter your PIN again.' : 'Something went wrong.');
  return new ApiError(response.status, body?.error ?? 'HTTP_ERROR', message, body?.details);
}

type QueryValue = string | number | boolean | null | undefined | string[];

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(buildUrl(path, options.query), {
    method,
    credentials: 'same-origin',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!response.ok) {
    const error = await parseError(response);
    if (response.status === 401) window.dispatchEvent(new CustomEvent('tally:unauthorized'));
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function download(path: string, filename: string, query?: Record<string, QueryValue>): Promise<void> {
  const response = await fetch(buildUrl(path, query), {
    credentials: 'same-origin',
    headers: { accept: 'text/csv' },
  });
  if (!response.ok) throw await parseError(response);
  downloadBlob(await response.blob(), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface MeResponse {
  user: PublicUser;
  settings: Settings;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

export interface MetaResponse {
  name: string;
  tagline: string;
  version: string;
  currencies: ReadonlyArray<{ code: string; name: string; symbol: string }>;
  primaryCurrencies: ReadonlyArray<string>;
}

export interface CashFlowQuery {
  from: string;
  to: string;
  granularity?: 'day' | 'week' | 'month';
  account_ids?: string[];
  category_ids?: string[];
  [key: string]: QueryValue;
}

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  color: string;
  amountCents: number;
  transactionCount: number;
  share: number;
}

export const api = {
  meta: () => request<MetaResponse>('/api/meta'),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  me: () => request<MeResponse>('/api/me'),
  setup: (body: {
    pin: string;
    displayName?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
  }) => request<MeResponse>('/api/auth/setup', { method: 'POST', body }),
  login: (pin: string) => request<MeResponse>('/api/auth/login', { method: 'POST', body: { pin } }),
  logout: async () => {
    try {
      await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Local state is cleared even if the session already expired.
    }
  },
  changePin: (currentPin: string, newPin: string) =>
    request<{ ok: true }>('/api/auth/change-pin', { method: 'POST', body: { currentPin, newPin } }),
  updateSettings: (body: Partial<Settings>) => request<{ settings: Settings }>('/api/settings', { method: 'PATCH', body }),
  updateProfile: (body: Record<string, unknown>) =>
    request<{ user: PublicUser; settings: Settings }>('/api/profile', { method: 'PATCH', body }),

  accounts: (includeArchived = false) => request<{ accounts: Account[] }>('/api/accounts', { query: { includeArchived } }),
  createAccount: (body: Record<string, unknown>) =>
    request<{ account: Account }>('/api/accounts', { method: 'POST', body }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    request<{ account: Account }>(`/api/accounts/${id}`, { method: 'PATCH', body }),
  deleteAccount: (id: string) => request<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  categories: (includeArchived = false) =>
    request<{ categories: Category[] }>('/api/categories', { query: { includeArchived } }),
  createCategory: (body: Record<string, unknown>) =>
    request<{ category: Category }>('/api/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    request<{ category: Category }>(`/api/categories/${id}`, { method: 'PATCH', body }),
  deleteCategory: (id: string) => request<{ ok: true }>(`/api/categories/${id}`, { method: 'DELETE' }),

  transactions: (query: Record<string, QueryValue>) => request<Paged<Transaction>>('/api/transactions', { query }),
  transaction: (id: string) => request<{ transaction: Transaction }>(`/api/transactions/${id}`),
  createTransaction: (body: Record<string, unknown>) =>
    request<{ transaction: Transaction }>('/api/transactions', { method: 'POST', body }),
  updateTransaction: (id: string, body: Record<string, unknown>) =>
    request<{ transaction: Transaction }>(`/api/transactions/${id}`, { method: 'PATCH', body }),
  deleteTransaction: (id: string) =>
    request<{ ok: true; deletedIds: string[] }>(`/api/transactions/${id}`, { method: 'DELETE' }),
  createTransfer: (body: Record<string, unknown>) =>
    request<{ transactions: Transaction[] }>('/api/transactions/transfer', { method: 'POST', body }),
  bulk: (body: { ids: string[]; action: 'delete' | 'categorize' | 'exclude' | 'include'; categoryId?: string | null }) =>
    request<{ ok: true; affected: number }>('/api/transactions/bulk', { method: 'POST', body }),

  cashFlow: (query: CashFlowQuery) => request<CashFlowPeriod[]>('/api/reports/cash-flow', { query }),
  summary: (query: { from: string; to: string }) =>
    request<DashboardSummary & { insights: string[] }>('/api/reports/summary', { query }),
  spending: (query: { from: string; to: string; kind?: 'expense' | 'income' }) =>
    request<{ kind: 'expense' | 'income'; from: string; to: string; categories: CategorySpend[] }>(
      '/api/reports/spending',
      { query },
    ),
  monthly: (query: { from: string; to: string }) =>
    request<{ months: Array<{ month: string; inflow: number; outflow: number; net: number }> }>('/api/reports/monthly', {
      query,
    }),
  netWorth: (months = 12) =>
    request<{ points: Array<{ month: string; balanceCents: number }> }>('/api/reports/net-worth', {
      query: { months },
    }),
  downloadCashFlowCsv: (query: CashFlowQuery) =>
    download('/api/reports/cash-flow.csv', `tally-cash-flow-${query.from}-to-${query.to}.csv`, query),
  downloadTransactionsCsv: (query: { from: string; to: string }) =>
    download('/api/reports/transactions.csv', `tally-transactions-${query.from}-to-${query.to}.csv`, query),

  budgets: (month: string) => request<{ month: string; budgets: Budget[] }>('/api/budgets', { query: { month } }),
  createBudget: (body: Record<string, unknown>) => request<{ budget: Budget }>('/api/budgets', { method: 'POST', body }),
  updateBudget: (id: string, body: Record<string, unknown>) =>
    request<{ budget: Budget }>(`/api/budgets/${id}`, { method: 'PATCH', body }),
  deleteBudget: (id: string) => request<{ ok: true }>(`/api/budgets/${id}`, { method: 'DELETE' }),
  copyBudgets: (from: string, to: string) =>
    request<{ copied: number; month: string }>('/api/budgets/copy', { method: 'POST', body: { from, to } }),
  goals: () => request<{ goals: Goal[] }>('/api/goals'),
  createGoal: (body: Record<string, unknown>) => request<{ goal: Goal }>('/api/goals', { method: 'POST', body }),
  updateGoal: (id: string, body: Record<string, unknown>) =>
    request<{ goal: Goal }>(`/api/goals/${id}`, { method: 'PATCH', body }),
  deleteGoal: (id: string) => request<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
  contribute: (id: string, body: Record<string, unknown>) =>
    request<{ goal: Goal }>(`/api/goals/${id}/contributions`, { method: 'POST', body }),
  contributions: (id: string) =>
    request<{ contributions: Array<{ id: string; amountCents: number; note: string | null; contributedAt: string }> }>(
      `/api/goals/${id}/contributions`,
    ),
  removeContribution: (goalId: string, contributionId: string) =>
    request<{ ok: true }>(`/api/goals/${goalId}/contributions/${contributionId}`, { method: 'DELETE' }),
};
