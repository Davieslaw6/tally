import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Eye, EyeOff, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { Transaction } from '../../shared/types';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/hooks';
import { useFormatDate, useMoney } from '../lib/session';
import { useToast } from '../components/Toast';
import { ConfirmDialog, EmptyState, ErrorState, LoadingBlock, PageHead } from '../components/ui';
import { TransactionDialog, TransferDialog } from '../components/TransactionDialog';

type Sort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const formatDate = useFormatDate();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<Sort>('date_desc');
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });

  useEffect(() => {
    const nextNew = searchParams.get('new') === '1';
    const focus = searchParams.get('focus');
    if (nextNew) setCreateOpen(true);
    if (focus) setEditId(focus);
    if (nextNew || focus) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setSelected(new Set());
    setLimit(100);
  }, [debouncedSearch, accountId, categoryId, type, from, to, sort]);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      account_ids: accountId || undefined,
      category_ids: categoryId || undefined,
      type,
      from: from || undefined,
      to: to || undefined,
      sort,
      limit,
      offset: 0,
    }),
    [debouncedSearch, accountId, categoryId, type, from, to, sort, limit],
  );

  const transactions = useQuery({
    queryKey: ['transactions', query],
    queryFn: () => api.transactions(query),
  });

  const invalidateLedger = () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    void queryClient.invalidateQueries({ queryKey: ['spending'] });
    void queryClient.invalidateQueries({ queryKey: ['monthly'] });
    void queryClient.invalidateQueries({ queryKey: ['budgets'] });
  };

  const bulk = useMutation({
    mutationFn: (input: { action: 'delete' | 'categorize' | 'exclude' | 'include'; categoryId?: string | null }) =>
      api.bulk({ ids: [...selected], ...input }),
    onSuccess: (result, input) => {
      const label =
        input.action === 'delete'
          ? 'deleted'
          : input.action === 'categorize'
            ? 'categorized'
            : input.action === 'exclude'
              ? 'hidden from reports'
              : 'returned to reports';
      toast.success(`${result.affected} transaction${result.affected === 1 ? '' : 's'} ${label}.`);
      setSelected(new Set());
      setBulkDeleteOpen(false);
      invalidateLedger();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The bulk update failed.'),
  });

  const removeOne = useMutation({
    mutationFn: (id: string) => api.deleteTransaction(id),
    onSuccess: () => {
      toast.success('Transaction deleted.');
      setDeleteTarget(null);
      invalidateLedger();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The transaction could not be deleted.'),
  });

  const allIds = transactions.data?.items.map((item) => item.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    setSelected(() => {
      if (allIds.every((id) => selected.has(id))) return new Set();
      return new Set(allIds);
    });
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setAccountId('');
    setCategoryId('');
    setType('all');
    setFrom('');
    setTo('');
    setSort('date_desc');
  };

  const hasFilters = !!(search || accountId || categoryId || type !== 'all' || from || to || sort !== 'date_desc');
  const visibleCategories = categories.data?.categories ?? [];
  const activeAccounts = (accounts.data?.accounts ?? []).filter((account) => !account.archived);
  const total = transactions.data?.total ?? 0;
  const shown = transactions.data?.items.length ?? 0;

  return (
    <div className="page">
      <PageHead
        title="Transactions"
        sub={
          <>
            <strong>{total.toLocaleString()}</strong> {hasFilters ? 'matching' : 'recorded'} entr{total === 1 ? 'y' : 'ies'}.
            Search covers descriptions, merchants, notes, and tags.
          </>
        }
        actions={
          <>
            <a href="#filters" className="btn sr-only">Skip to filters</a>
            <button type="button" className="btn" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight size={15} /> <span className="btn-label">Transfer</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> <span className="btn-label">Add transaction</span>
            </button>
          </>
        }
      />

      <div id="filters" className="filters" role="search" aria-label="Filter transactions">
        <div className="search-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search description, merchant, notes, or tags"
            aria-label="Search transactions"
          />
        </div>
        <div className="select-wrap">
          <select className="select" aria-label="Account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">All accounts</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </div>
        <div className="select-wrap">
          <select className="select" aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </div>
        <div className="select-wrap">
          <select className="select" aria-label="Direction" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            <option value="all">In and out</option>
            <option value="inflow">Money in</option>
            <option value="outflow">Money out</option>
          </select>
        </div>
        <div className="select-wrap">
          <select className="select" aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
          </select>
        </div>
        <label className="sr-only" htmlFor="tx-filter-from">From date</label>
        <input id="tx-filter-from" className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ width: 124 }} />
        <label className="sr-only" htmlFor="tx-filter-to">To date</label>
        <input id="tx-filter-to" className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ width: 124 }} />
        {hasFilters ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={clearFilters}>
            <X size={13} /> Clear
          </button>
        ) : null}
      </div>

      {someSelected ? (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <div className="select-wrap" style={{ width: 190 }}>
            <select className="select" aria-label="Bulk category" value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
              <option value="">Choose category…</option>
              {visibleCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!bulkCategory || bulk.isPending}
            onClick={() => bulk.mutate({ action: 'categorize', categoryId: bulkCategory })}
          >
            Apply category
          </button>
          <button type="button" className="btn btn-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'exclude' })}>
            <EyeOff size={13} /> Hide
          </button>
          <button type="button" className="btn btn-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'include' })}>
            <Eye size={13} /> Show
          </button>
          <button type="button" className="btn btn-sm btn-danger" disabled={bulk.isPending} onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="card" style={{ overflow: 'hidden' }}>
        {transactions.isError ? (
          <div style={{ padding: 20 }}>
            <ErrorState
              message={transactions.error instanceof Error ? transactions.error.message : undefined}
              onRetry={() => void transactions.refetch()}
            />
          </div>
        ) : transactions.isLoading ? (
          <div style={{ padding: 20 }}>
            <LoadingBlock lines={6} label="Loading transactions" />
          </div>
        ) : transactions.data?.items.length ? (
          <>
            <div className="table-shell">
              <table className="tx-table">
                <caption className="sr-only">Ledger transactions with account, category, and amount.</caption>
                <thead>
                  <tr>
                    <th scope="col" className="check">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label={allSelected ? 'Deselect all visible transactions' : 'Select all visible transactions'}
                      />
                    </th>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Account</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.items.map((transaction) => (
                    <tr key={transaction.id} style={transaction.excludedFromReports ? { opacity: 0.62 } : undefined}>
                      <td className="check">
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={selected.has(transaction.id)}
                          onChange={() => toggleOne(transaction.id)}
                          aria-label={`Select ${transaction.description}`}
                        />
                      </td>
                      <td className="date">{formatDate(transaction.date)}</td>
                      <td className="desc">
                        <div className="tx-desc-line">
                          <button type="button" className="text-button tx-desc-text" onClick={() => setEditId(transaction.id)}>
                            {transaction.description}
                          </button>
                          {transaction.isTransfer ? <span className="badge">Transfer</span> : null}
                          {transaction.isSplit ? <span className="badge">Split</span> : null}
                          {transaction.excludedFromReports ? <span className="badge">Hidden</span> : null}
                        </div>
                        <div className="tx-sub">
                          {transaction.merchant && transaction.merchant !== transaction.description ? <span>{transaction.merchant}</span> : null}
                          {transaction.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                        </div>
                      </td>
                      <td><span className="muted">{transaction.accountName}</span></td>
                      <td>
                        {transaction.categoryName ? (
                          <span className="cat-cell">
                            <span className="cat-dot" style={{ background: transaction.categoryColor ?? undefined }} />
                            {transaction.categoryName}
                          </span>
                        ) : (
                          <span className="faint">{transaction.isTransfer ? 'Transfer' : 'Uncategorized'}</span>
                        )}
                      </td>
                      <td className={`num amount ${transaction.amountCents >= 0 ? 'positive' : ''}`}>
                        {money(transaction.amountCents, { signed: true })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <button type="button" className="icon-btn" aria-label={`Edit ${transaction.description}`} onClick={() => setEditId(transaction.id)}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" className="icon-btn" aria-label={`Delete ${transaction.description}`} onClick={() => setDeleteTarget(transaction)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Showing {shown} of {total.toLocaleString()}
                {total > 200 ? ' · refine filters to narrow the ledger' : ''}
              </span>
              {shown < total && limit < 200 ? (
                <button type="button" className="btn btn-sm" onClick={() => setLimit(200)}>Load more</button>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<ArrowLeftRight size={16} />}
            title={hasFilters ? 'No transactions match those filters' : 'No transactions yet'}
            copy={
              hasFilters
                ? 'Try a wider date range or clear one of the filters.'
                : 'Add your first transaction, or move money between two accounts with a transfer.'
            }
            action={
              hasFilters ? (
                <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}><Plus size={13} /> Add transaction</button>
                  <button type="button" className="btn btn-sm" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={13} /> Transfer</button>
                </div>
              )
            }
          />
        )}
      </div>

      <TransactionDialog
        open={createOpen || !!editId}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditId(null);
          }
        }}
        transactionId={editId}
        accounts={accounts.data?.accounts ?? []}
        categories={visibleCategories}
      />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={activeAccounts} />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this transaction?"
        confirmLabel={deleteTarget?.isTransfer ? 'Delete transfer pair' : 'Delete transaction'}
        busy={removeOne.isPending}
        onConfirm={() => {
          if (deleteTarget) removeOne.mutate(deleteTarget.id);
        }}
        description={
          deleteTarget?.isTransfer
            ? 'Both linked transfer entries will be removed. This cannot be undone.'
            : 'The entry and any split parts will be removed. This cannot be undone.'
        }
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`}
        confirmLabel="Delete selected"
        busy={bulk.isPending}
        onConfirm={() => bulk.mutate({ action: 'delete' })}
        description="Selected entries and their split parts will be removed. This cannot be undone."
      />
    </div>
  );
}
