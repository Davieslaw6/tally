import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Banknote,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { Account, Category } from '../../shared/types';
import { api } from '../lib/api';
import { centsToInput, moneyInputToCents } from '../lib/finance';
import { useMoney } from '../lib/session';
import { useToast } from '../components/Toast';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Modal,
  PageHead,
  Spinner,
  StatusPill,
} from '../components/ui';

type Tab = 'accounts' | 'categories';

const ACCOUNT_TYPES: Array<{ value: Account['type']; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
];

const ACCOUNT_COLORS = [
  'oklch(0.70 0.08 220)',
  'oklch(0.70 0.10 155)',
  'oklch(0.66 0.12 45)',
  'oklch(0.64 0.10 300)',
  'oklch(0.72 0.11 90)',
];

const CATEGORY_COLORS = [
  'oklch(0.65 0.10 155)',
  'oklch(0.66 0.12 45)',
  'oklch(0.65 0.09 240)',
  'oklch(0.67 0.11 320)',
  'oklch(0.72 0.11 85)',
  'oklch(0.60 0.07 200)',
];

function parseTab(value: string | null): Tab {
  return value === 'categories' ? 'categories' : 'accounts';
}

function AccountIcon({ type }: { type: Account['type'] }) {
  const Icon = type === 'credit' ? CreditCard : type === 'savings' ? Wallet : type === 'cash' ? Banknote : type === 'investment' ? TrendingUp : Landmark;
  return <Icon size={15} />;
}

export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const tab = parseTab(searchParams.get('tab'));
  const [showArchived, setShowArchived] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEdit, setAccountEdit] = useState<Account | null>(null);
  const [accountDelete, setAccountDelete] = useState<Account | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
  const [categoryDelete, setCategoryDelete] = useState<Category | null>(null);

  const accounts = useQuery({ queryKey: ['accounts', true], queryFn: () => api.accounts(true) });
  const categories = useQuery({ queryKey: ['categories', true], queryFn: () => api.categories(true) });

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'accounts') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const invalidateAccounts = () => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['cashflow'] });
  };

  const invalidateCategories = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['budgets'] });
  };

  const saveAccount = useMutation({
    mutationFn: (input: { id?: string; name: string; type: Account['type']; institution: string | null; openingBalanceCents: number; color: string }) =>
      input.id
        ? api.updateAccount(input.id, { name: input.name, type: input.type, institution: input.institution, openingBalanceCents: input.openingBalanceCents, color: input.color })
        : api.createAccount({ name: input.name, type: input.type, institution: input.institution, openingBalanceCents: input.openingBalanceCents, color: input.color }),
    onSuccess: (_result, input) => {
      toast.success(input.id ? 'Account updated.' : 'Account added.');
      setAccountOpen(false);
      setAccountEdit(null);
      invalidateAccounts();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The account could not be saved.'),
  });

  const archiveAccount = useMutation({
    mutationFn: (account: Account) => api.updateAccount(account.id, { archived: !account.archived }),
    onSuccess: (result) => {
      toast.success(result.account.archived ? 'Account archived. Its history stays intact.' : 'Account restored to active.');
      invalidateAccounts();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The account could not be archived.'),
  });

  const removeAccount = useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onSuccess: () => {
      toast.success('Empty account deleted.');
      setAccountDelete(null);
      invalidateAccounts();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The account could not be deleted.'),
  });

  const saveCategory = useMutation({
    mutationFn: (input: { id?: string; name: string; kind: 'expense' | 'income'; color: string }) =>
      input.id
        ? api.updateCategory(input.id, { name: input.name, color: input.color })
        : api.createCategory({ name: input.name, kind: input.kind, color: input.color }),
    onSuccess: (_result, input) => {
      toast.success(input.id ? 'Category updated.' : 'Category added.');
      setCategoryOpen(false);
      setCategoryEdit(null);
      invalidateCategories();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The category could not be saved.'),
  });

  const archiveCategory = useMutation({
    mutationFn: (category: Category) => api.updateCategory(category.id, { archived: !category.archived }),
    onSuccess: (result) => {
      toast.success(result.category.archived ? 'Category archived. Existing entries keep their label.' : 'Category restored.');
      invalidateCategories();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The category could not be archived.'),
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      toast.success('Category deleted.');
      setCategoryDelete(null);
      invalidateCategories();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The category could not be deleted.'),
  });

  const accountRows = accounts.data?.accounts ?? [];
  const visibleAccounts = showArchived ? accountRows : accountRows.filter((account) => !account.archived);
  const categoryRows = categories.data?.categories ?? [];
  const visibleCategories = showArchived ? categoryRows : categoryRows.filter((category) => !category.archived);
  const activeAccounts = accountRows.filter((account) => !account.archived);
  const activeTotal = activeAccounts.reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const activeCategoryCount = categoryRows.filter((category) => !category.archived).length;

  return (
    <div className="page">
      <PageHead
        title="Accounts"
        sub={
          <>
            <strong>{activeAccounts.length}</strong> active account{activeAccounts.length === 1 ? '' : 's'} ·{' '}
            {activeCategoryCount} categor{activeCategoryCount === 1 ? 'y' : 'ies'}.
          </>
        }
        actions={
          tab === 'accounts' ? (
            <>
              <label className="inline-check" style={{ marginRight: 4 }}>
                <input type="checkbox" className="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                <span>Show archived</span>
              </label>
              <button type="button" className="btn btn-primary" onClick={() => { setAccountEdit(null); setAccountOpen(true); }}>
                <Plus size={15} /> <span className="btn-label">Add account</span>
              </button>
            </>
          ) : (
            <>
              <label className="inline-check" style={{ marginRight: 4 }}>
                <input type="checkbox" className="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                <span>Show archived</span>
              </label>
              <button type="button" className="btn btn-primary" onClick={() => { setCategoryEdit(null); setCategoryOpen(true); }}>
                <Plus size={15} /> <span className="btn-label">Add category</span>
              </button>
            </>
          )
        }
      />

      <div className="tabs" role="tablist" aria-label="Accounts views">
        <button type="button" role="tab" aria-selected={tab === 'accounts'} className="tab" onClick={() => setTab('accounts')}>
          Accounts <span className="badge">{activeAccounts.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'categories'} className="tab" onClick={() => setTab('categories')}>
          Categories <span className="badge">{activeCategoryCount}</span>
        </button>
      </div>

      {tab === 'accounts' ? (
        <div className="section-gap" role="tabpanel" aria-label="Accounts">
          <div className="account-layout">
            <section className="card" aria-labelledby="account-list-title">
              <div className="card-head" style={{ paddingBottom: 12 }}>
                <div>
                  <h2 id="account-list-title" className="card-title">Chart of accounts</h2>
                  <p className="card-meta">Balances include every transaction, including hidden and transfer rows.</p>
                </div>
                <StatusPill>{visibleAccounts.length} shown</StatusPill>
              </div>
              <div className="card-body-tight">
                {accounts.isError ? (
                  <ErrorState message={accounts.error instanceof Error ? accounts.error.message : undefined} onRetry={() => void accounts.refetch()} />
                ) : accounts.isLoading ? (
                  <LoadingBlock lines={5} label="Loading accounts" />
                ) : visibleAccounts.length ? (
                  visibleAccounts.map((account) => (
                    <div className="account-row" key={account.id}>
                      <div className="account-name">
                        <span className="account-mark" style={{ borderLeft: `2px solid ${account.color}` }} aria-hidden="true">
                          <AccountIcon type={account.type} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <strong>{account.name}</strong>
                          <span>
                            {ACCOUNT_TYPES.find((type) => type.value === account.type)?.label ?? account.type}
                            {account.institution ? ` · ${account.institution}` : ''}
                            {account.archived ? ' · Archived' : ''}
                          </span>
                        </span>
                      </div>
                      <div className="account-balance">
                        {money(account.currentBalanceCents)}
                        <small>Opened at {money(account.openingBalanceCents)}</small>
                      </div>
                      <div className="simple-row-side">
                        <button type="button" className="icon-btn" aria-label={`Edit ${account.name}`} onClick={() => { setAccountEdit(account); setAccountOpen(true); }}>
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={account.archived ? `Restore ${account.name}` : `Archive ${account.name}`}
                          title={account.archived ? 'Restore account' : 'Archive account'}
                          onClick={() => archiveAccount.mutate(account)}
                          disabled={archiveAccount.isPending}
                        >
                          {account.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Delete ${account.name}`} onClick={() => setAccountDelete(account)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<Landmark size={16} />}
                    title="No accounts visible"
                    copy="Add a checking, savings, credit, cash, or investment account. Every transaction belongs to one."
                    action={<button type="button" className="btn btn-sm btn-primary" onClick={() => setAccountOpen(true)}>Add an account</button>}
                  />
                )}
              </div>
            </section>

            <aside className="account-side">
              <section className="card card-pad" aria-labelledby="net-position-title">
                <div className="section-head">
                  <h2 id="net-position-title" className="section-title">Net position</h2>
                  <Landmark size={15} className="faint" aria-hidden="true" />
                </div>
                <div className="net-position">{money(activeTotal, { signed: true })}</div>
                <p className="hint">Active accounts, opening balances plus every ledger entry.</p>
                <div className="budget-health" style={{ marginTop: 16 }}>
                  <div>
                    <span>Active</span>
                    <strong>{activeAccounts.length}</strong>
                  </div>
                  <div>
                    <span>Archived</span>
                    <strong>{accountRows.filter((account) => account.archived).length}</strong>
                  </div>
                  <div>
                    <span>Currency</span>
                    <strong style={{ fontSize: 13 }}>{activeAccounts[0]?.currency ?? '—'}</strong>
                  </div>
                </div>
              </section>

              <section className="card card-pad" aria-labelledby="hygiene-title">
                <div className="section-head">
                  <h2 id="hygiene-title" className="section-title">Housekeeping</h2>
                  <Pencil size={15} className="faint" aria-hidden="true" />
                </div>
                <div className="simple-list">
                  <button type="button" className="simple-row" style={{ background: 'none', border: 'none', textAlign: 'left', width: '100%' }} onClick={() => setTab('categories')}>
                    <div className="simple-row-main">
                      <div className="simple-row-title">Category library</div>
                      <div className="simple-row-sub">{activeCategoryCount} active labels for reporting.</div>
                    </div>
                    <Pencil size={14} className="faint" aria-hidden="true" />
                  </button>
                  <Link to="/transactions" className="simple-row">
                    <div className="simple-row-main">
                      <div className="simple-row-title">Transaction ledger</div>
                      <div className="simple-row-sub">Review, edit, hide, or delete entries.</div>
                    </div>
                    <Landmark size={14} className="faint" aria-hidden="true" />
                  </Link>
                </div>
              </section>

              <section className="card card-pad">
                <h2 className="section-title">About balances</h2>
                <p className="hint" style={{ marginBottom: 0 }}>
                  Account balances are opening balances plus every transaction in the ledger. Transfers and hidden
                  entries still count toward balances, but are omitted from reports and budgets.
                </p>
              </section>
            </aside>
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="section-gap" role="tabpanel" aria-label="Categories">
          {categories.isError ? (
            <ErrorState message={categories.error instanceof Error ? categories.error.message : undefined} onRetry={() => void categories.refetch()} />
          ) : categories.isLoading ? (
            <LoadingBlock lines={5} label="Loading categories" />
          ) : visibleCategories.length ? (
            <div className="category-columns">
              {(['expense', 'income'] as const).map((kind) => {
                const rows = visibleCategories.filter((category) => category.kind === kind);
                return (
                  <section className="card" key={kind} aria-labelledby={`category-${kind}-title`}>
                    <div className="card-head" style={{ paddingBottom: 12 }}>
                      <div>
                        <h2 id={`category-${kind}-title`} className="card-title">{kind === 'expense' ? 'Expense categories' : 'Income categories'}</h2>
                        <p className="card-meta">{kind === 'expense' ? 'Spending labels used in budgets and reports.' : 'Money-in labels for pay, refunds, and other income.'}</p>
                      </div>
                      <StatusPill>{rows.length}</StatusPill>
                    </div>
                    <div className="card-body-tight">
                      {rows.length ? rows.map((category) => (
                        <div className={`category-row ${category.archived ? 'archived' : ''}`} key={category.id}>
                          <span className="cat-dot" style={{ background: category.color, width: 9, height: 9 }} aria-hidden="true" />
                          <div className="category-main">
                            <span className="category-name">{category.name}</span>
                            <span className="category-meta">
                              {category.isSystem ? 'Built-in' : 'Custom'}
                              {category.archived ? ' · Archived' : ''}
                            </span>
                          </div>
                          <div className="simple-row-side">
                            <button type="button" className="icon-btn" aria-label={`Edit ${category.name}`} onClick={() => { setCategoryEdit(category); setCategoryOpen(true); }}>
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={category.archived ? `Restore ${category.name}` : `Archive ${category.name}`}
                              onClick={() => archiveCategory.mutate(category)}
                              disabled={archiveCategory.isPending}
                            >
                              {category.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                            </button>
                            <button type="button" className="icon-btn" aria-label={`Delete ${category.name}`} onClick={() => setCategoryDelete(category)} disabled={category.isSystem}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )) : <p className="hint" style={{ padding: '10px 0' }}>No {kind} categories yet.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <section className="card card-pad">
              <EmptyState icon={<Pencil size={16} />} title="No categories visible" copy="Add an expense or income category to label the ledger." />
            </section>
          )}
          <p className="hint" style={{ marginTop: 14 }}>
            Built-in categories can be archived but not deleted. Categories with transactions can be archived; TALLY keeps
            their history intact.
          </p>
        </div>
      ) : null}

      {accountOpen ? (
        <AccountDialog
          account={accountEdit}
          busy={saveAccount.isPending}
          onClose={() => { setAccountOpen(false); setAccountEdit(null); }}
          onSave={(input) => saveAccount.mutate(input)}
        />
      ) : null}

      {categoryOpen ? (
        <CategoryDialog
          category={categoryEdit}
          busy={saveCategory.isPending}
          onClose={() => { setCategoryOpen(false); setCategoryEdit(null); }}
          onSave={(input) => saveCategory.mutate(input)}
        />
      ) : null}

      <ConfirmDialog
        open={!!accountDelete}
        onOpenChange={(open) => { if (!open) setAccountDelete(null); }}
        title="Delete this account?"
        confirmLabel="Delete account"
        busy={removeAccount.isPending}
        onConfirm={() => accountDelete && removeAccount.mutate(accountDelete.id)}
        description={accountDelete ? `“${accountDelete.name}” can only be deleted while it has no transactions. If it has history, archive it instead.` : ''}
      />

      <ConfirmDialog
        open={!!categoryDelete}
        onOpenChange={(open) => { if (!open) setCategoryDelete(null); }}
        title="Delete this category?"
        confirmLabel="Delete category"
        busy={removeCategory.isPending}
        onConfirm={() => categoryDelete && removeCategory.mutate(categoryDelete.id)}
        description={categoryDelete ? `“${categoryDelete.name}” can only be deleted if no transaction or split uses it. Archiving keeps the label on past entries.` : ''}
      />
    </div>
  );
}

function AccountDialog({
  account,
  busy,
  onClose,
  onSave,
}: {
  account: Account | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; name: string; type: Account['type']; institution: string | null; openingBalanceCents: number; color: string }) => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'checking');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [opening, setOpening] = useState(account ? centsToInput(account.openingBalanceCents) : '0.00');
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[0]!);
  const [error, setError] = useState('');
  const cents = moneyInputToCents(opening);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the account a name.');
    if (!Number.isSafeInteger(cents)) return setError('Enter a valid opening balance.');
    onSave({ id: account?.id, name: name.trim(), type, institution: institution.trim() || null, openingBalanceCents: cents, color });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={account ? 'Edit account' : 'Add an account'}
      description="Opening balance is the figure before any TALLY transactions."
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="account-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner label="Saving account" /> : null} Save account
          </button>
        </>
      }
    >
      <form id="account-form" className="form-grid" onSubmit={submit}>
        <Field label="Name" htmlFor="account-name" className="full">
          <input id="account-name" className="input" value={name} maxLength={80} placeholder="Everyday checking" onChange={(event) => { setName(event.target.value); setError(''); }} />
        </Field>
        <Field label="Type" htmlFor="account-type">
          <span className="select-wrap">
            <select id="account-type" className="select" value={type} onChange={(event) => setType(event.target.value as Account['type'])}>
              {ACCOUNT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </span>
        </Field>
        <Field label="Institution" hint="Optional." htmlFor="account-institution">
          <input id="account-institution" className="input" value={institution} maxLength={100} placeholder="Bank or wallet" onChange={(event) => setInstitution(event.target.value)} />
        </Field>
        <Field label="Opening balance" hint="Negative is fine for credit balances." htmlFor="account-opening">
          <input id="account-opening" className="input" inputMode="decimal" value={opening} onChange={(event) => { setOpening(event.target.value); setError(''); }} aria-invalid={!!error} />
        </Field>
        <div className="field">
          <span className="label">Accent color</span>
          <div className="color-swatches" role="group" aria-label="Account color">
            {ACCOUNT_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className="color-swatch"
                style={{ background: option }}
                data-active={color === option}
                aria-label={`Use color ${option}`}
                aria-pressed={color === option}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </div>
        {error ? <p className="form-error full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

function CategoryDialog({
  category,
  busy,
  onClose,
  onSave,
}: {
  category: Category | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; name: string; kind: 'expense' | 'income'; color: string }) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<'expense' | 'income'>(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]!);
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the category a name.');
    onSave({ id: category?.id, name: name.trim(), kind, color });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={category ? 'Edit category' : 'Add a category'}
      description={category ? 'The kind is fixed after creation so reports stay stable.' : 'Expense labels drive budgets and spending reports.'}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="category-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner label="Saving category" /> : null} Save category
          </button>
        </>
      }
    >
      <form id="category-form" className="form-grid" onSubmit={submit}>
        <Field label="Name" htmlFor="category-name" className="full">
          <input id="category-name" className="input" value={name} maxLength={60} placeholder="Groceries" onChange={(event) => { setName(event.target.value); setError(''); }} />
        </Field>
        <Field label="Kind" htmlFor="category-kind">
          <span className="select-wrap">
            <select id="category-kind" className="select" value={kind} disabled={!!category} onChange={(event) => setKind(event.target.value as 'expense' | 'income')}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </span>
        </Field>
        <div className="field">
          <span className="label">Color</span>
          <div className="color-swatches" role="group" aria-label="Category color">
            {CATEGORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className="color-swatch"
                style={{ background: option }}
                data-active={color === option}
                aria-label={`Use color ${option}`}
                aria-pressed={color === option}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </div>
        {error ? <p className="form-error full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
