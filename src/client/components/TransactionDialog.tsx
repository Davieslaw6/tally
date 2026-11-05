import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, SplitSquareHorizontal, Trash2, X } from 'lucide-react';
import type { Account, Category } from '../../shared/types';
import { api } from '../lib/api';
import { centsToInput, moneyInputToCents, todayISO } from '../lib/finance';
import { useSession, useMoney } from '../lib/session';
import { useToast } from './Toast';
import { ConfirmDialog, Field, Modal, Notice, Spinner } from './ui';

interface RowForm {
  categoryId: string;
  amount: string;
  note: string;
}

interface FormState {
  kind: 'outflow' | 'inflow';
  amount: string;
  date: string;
  description: string;
  merchant: string;
  notes: string;
  tags: string;
  accountId: string;
  categoryId: string;
  excluded: boolean;
  splitMode: boolean;
  splits: RowForm[];
}

function baseForm(accounts: Account[], timezone: string): FormState {
  return {
    kind: 'outflow',
    amount: '',
    date: todayISO(timezone),
    description: '',
    merchant: '',
    notes: '',
    tags: '',
    accountId: accounts[0]?.id ?? '',
    categoryId: '',
    excluded: false,
    splitMode: false,
    splits: [
      { categoryId: '', amount: '', note: '' },
      { categoryId: '', amount: '', note: '' },
    ],
  };
}

export function TransactionDialog({
  open,
  onOpenChange,
  transactionId,
  accounts,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string | null;
  accounts: Account[];
  categories: Category[];
  onSaved?: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const detail = useQuery({
    queryKey: ['transaction', transactionId],
    queryFn: () => api.transaction(transactionId!),
    enabled: open && !!transactionId,
  });
  const [form, setForm] = useState<FormState>(() => baseForm(accounts, user?.timezone || 'UTC'));
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const transaction = detail.data?.transaction;
  const isTransfer = transaction?.isTransfer ?? false;

  useEffect(() => {
    if (!open) return;
    setError('');
    if (!transactionId) {
      setForm(baseForm(accounts, user?.timezone || 'UTC'));
      return;
    }
    if (!transaction) return;
    const kind = transaction.amountCents >= 0 ? 'inflow' : 'outflow';
    setForm({
      kind,
      amount: centsToInput(Math.abs(transaction.amountCents)),
      date: transaction.date,
      description: transaction.description,
      merchant: transaction.merchant ?? '',
      notes: transaction.notes ?? '',
      tags: transaction.tags.join(', '),
      accountId: transaction.accountId,
      categoryId: transaction.categoryId ?? '',
      excluded: transaction.excludedFromReports,
      splitMode: !!transaction.splits?.length,
      splits: transaction.splits?.length
        ? transaction.splits.map((split) => ({
            categoryId: split.categoryId,
            amount: centsToInput(Math.abs(split.amountCents)),
            note: split.note ?? '',
          }))
        : [
            { categoryId: '', amount: '', note: '' },
            { categoryId: '', amount: '', note: '' },
          ],
    });
  }, [open, transactionId, transaction, accounts, user?.timezone]);

  const filteredCategories = useMemo(
    () => categories.filter((category) => (form.kind === 'outflow' ? category.kind === 'expense' : category.kind === 'income')),
    [categories, form.kind],
  );

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const changeKind = (kind: FormState['kind']) => {
    setForm((current) => ({
      ...current,
      kind,
      categoryId: '',
      splits: current.splits.map((row) => ({ ...row, categoryId: '' })),
    }));
  };

  const updateSplit = (index: number, patch: Partial<RowForm>) => {
    setForm((current) => ({
      ...current,
      splits: current.splits.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  };

  const parsedTotal = useMemo(() => {
    try {
      return Math.abs(moneyInputToCents(form.amount || '0'));
    } catch {
      return Number.NaN;
    }
  }, [form.amount]);

  const splitTotal = useMemo(() => {
    let total = 0;
    for (const row of form.splits) {
      try {
        total += Math.abs(moneyInputToCents(row.amount || '0'));
      } catch {
        return NaN;
      }
    }
    return total;
  }, [form.splits]);

  const save = useMutation({
    mutationFn: async () => {
      const amountCents = Math.abs(moneyInputToCents(form.amount));
      if (!amountCents) throw new Error('Enter an amount greater than zero.');
      if (!form.description.trim()) throw new Error('Add a short description.');
      if (!form.accountId) throw new Error('Choose an account.');
      if (!form.date) throw new Error('Choose a date.');
      if (form.splitMode) {
        if (form.splits.length < 2) throw new Error('A split needs at least two parts.');
        if (form.splits.some((row) => !row.categoryId)) throw new Error('Choose a category for each split.');
        if (splitTotal !== amountCents) {
          throw new Error(`Split amounts add up to ${money(splitTotal)}, but the transaction is ${money(amountCents)}.`);
        }
      }
      const payload: Record<string, unknown> = {
        accountId: form.accountId,
        categoryId: form.splitMode ? null : form.categoryId || null,
        amountCents: form.kind === 'outflow' ? -amountCents : amountCents,
        date: form.date,
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
        excludedFromReports: form.excluded,
      };
      if (form.splitMode) {
        payload.splits = form.splits.map((row) => ({
          categoryId: row.categoryId,
          amountCents: (form.kind === 'outflow' ? -1 : 1) * Math.abs(moneyInputToCents(row.amount)),
          note: row.note.trim() || null,
        }));
      }
      if (transactionId) return api.updateTransaction(transactionId, payload);
      return api.createTransaction(payload);
    },
    onSuccess: () => {
      toast.success(transactionId ? 'Transaction updated.' : 'Transaction added to the ledger.');
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      void queryClient.invalidateQueries({ queryKey: ['transaction', transactionId] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'The transaction could not be saved.'),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteTransaction(transactionId!),
    onSuccess: () => {
      toast.success(isTransfer ? 'Transfer removed from both accounts.' : 'Transaction deleted.');
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      setDeleteOpen(false);
      onOpenChange(false);
      onSaved?.();
    },
    onError: (caught) => toast.error(caught instanceof Error ? caught.message : 'The transaction could not be deleted.'),
  });

  const title = transactionId ? (isTransfer ? 'Transfer details' : 'Edit transaction') : 'Add transaction';
  const loading = !!transactionId && detail.isLoading;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={
          isTransfer
            ? 'Transfers create two linked entries and never count as income or spending.'
            : transactionId
              ? 'Changes are saved directly to your ledger.'
              : 'Cash out is negative, cash in is positive.'
        }
        wide
        footer={
          <>
            {transactionId ? (
              <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
            <button type="button" className="btn btn-quiet" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </button>
            {!isTransfer ? (
              <button type="button" className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || loading}>
                {save.isPending ? <Spinner label="Saving transaction" /> : null}
                {transactionId ? 'Save changes' : 'Add transaction'}
              </button>
            ) : null}
          </>
        }
      >
        {loading ? (
          <div className="loading-block" aria-busy="true">
            <div className="skeleton" style={{ height: 16, width: '40%' }} />
            <div className="skeleton" style={{ height: 88 }} />
            <div className="skeleton" style={{ height: 88 }} />
          </div>
        ) : isTransfer && transaction ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <Notice>This transfer is a linked pair. Editing or deleting the pair changes both account balances.</Notice>
            <div className="form-grid">
              <Field label="Description"><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{transaction.description}</div></Field>
              <Field label="Date"><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{transaction.date}</div></Field>
              <Field label="Account"><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{transaction.accountName}</div></Field>
              <Field label="Amount"><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{money(transaction.amountCents)}</div></Field>
            </div>
            <p className="hint">Create a replacement transfer from the Transactions screen if the amount or accounts were wrong.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div className="field">
                <span className="label">Direction</span>
                <div className="segmented" role="group" aria-label="Transaction direction">
                  <button type="button" aria-pressed={form.kind === 'outflow'} onClick={() => changeKind('outflow')}>Money out</button>
                  <button type="button" aria-pressed={form.kind === 'inflow'} onClick={() => changeKind('inflow')}>Money in</button>
                </div>
              </div>
              <div className="field" style={{ minWidth: 190 }}>
                <label className="label" htmlFor="tx-amount">Amount</label>
                <input
                  id="tx-amount"
                  className="input"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => update('amount', event.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            <div className="form-grid">
              <Field label="Description" htmlFor="tx-description" className="full">
                <input
                  id="tx-description"
                  className="input"
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                  maxLength={500}
                  placeholder="What was this for?"
                  required
                />
              </Field>
              <Field label="Date" htmlFor="tx-date">
                <input id="tx-date" className="input" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required />
              </Field>
              <Field label="Account" htmlFor="tx-account">
                <div className="select-wrap">
                  <select id="tx-account" className="select" value={form.accountId} onChange={(event) => update('accountId', event.target.value)} required>
                    <option value="">Choose an account</option>
                    {accounts.filter((account) => !account.archived).map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>
              </Field>
              {!form.splitMode ? (
                <Field label="Category" htmlFor="tx-category" hint={form.kind === 'inflow' ? 'Income categories' : 'Expense categories'}>
                  <div className="select-wrap">
                    <select id="tx-category" className="select" value={form.categoryId} onChange={(event) => update('categoryId', event.target.value)}>
                      <option value="">Uncategorized</option>
                      {filteredCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                </Field>
              ) : <div />}
              <Field label="Merchant" htmlFor="tx-merchant">
                <input id="tx-merchant" className="input" value={form.merchant} onChange={(event) => update('merchant', event.target.value)} maxLength={200} placeholder="Optional" />
              </Field>
              <Field label="Tags" htmlFor="tx-tags" hint="Comma separated, up to 12.">
                <input id="tx-tags" className="input" value={form.tags} onChange={(event) => update('tags', event.target.value)} placeholder="travel, reimbursable" />
              </Field>
              <Field label="Notes" htmlFor="tx-notes" className="full">
                <textarea id="tx-notes" className="textarea" value={form.notes} onChange={(event) => update('notes', event.target.value)} maxLength={5000} placeholder="Anything worth remembering later." />
              </Field>
            </div>

            {!transactionId ? (
              <div>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={form.splitMode}
                    onChange={(event) => update('splitMode', event.target.checked)}
                  />
                  <span>
                    <strong style={{ display: 'block', color: 'var(--ink)', fontWeight: 550 }}>Split across categories</strong>
                    Divide this transaction between two or more envelopes. The parts must add up to the total.
                  </span>
                </label>
              </div>
            ) : form.splitMode ? (
              <p className="hint"><SplitSquareHorizontal size={13} style={{ verticalAlign: -2 }} /> This transaction is split. Update every part when changing the total.</p>
            ) : null}

            {form.splitMode ? (
              <div className="card card-pad" style={{ background: 'var(--raised)' }}>
                <div className="section-head">
                  <h3 className="section-title" style={{ fontSize: 13 }}>Split parts</h3>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => update('splits', [...form.splits, { categoryId: '', amount: '', note: '' }])}
                    disabled={form.splits.length >= 20}
                  >
                    <Plus size={13} /> Add part
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {form.splits.map((row, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.3fr) 120px minmax(100px, 1fr) auto', gap: 8, alignItems: 'center' }}>
                      <div className="select-wrap">
                        <select className="select" aria-label={`Split ${index + 1} category`} value={row.categoryId} onChange={(event) => updateSplit(index, { categoryId: event.target.value })}>
                          <option value="">Category</option>
                          {filteredCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                      </div>
                      <input className="input" aria-label={`Split ${index + 1} amount`} inputMode="decimal" placeholder="0.00" value={row.amount} onChange={(event) => updateSplit(index, { amount: event.target.value })} />
                      <input className="input" aria-label={`Split ${index + 1} note`} placeholder="Note" value={row.note} onChange={(event) => updateSplit(index, { note: event.target.value })} />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove split ${index + 1}`}
                        onClick={() => update('splits', form.splits.filter((_, rowIndex) => rowIndex !== index))}
                        disabled={form.splits.length <= 2}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className={`hint ${Number.isFinite(splitTotal) && Number.isFinite(parsedTotal) && form.amount && splitTotal !== parsedTotal ? 'negative' : ''}`} style={{ marginTop: 10 }}>
                  Split total {Number.isFinite(splitTotal) ? money(splitTotal) : '—'} · Transaction total {form.amount && Number.isFinite(parsedTotal) ? money(parsedTotal) : '—'}
                </p>
              </div>
            ) : null}

            <label className="inline-check">
              <input type="checkbox" className="checkbox" checked={form.excluded} onChange={(event) => update('excluded', event.target.checked)} />
              <span>
                <strong style={{ display: 'block', color: 'var(--ink)', fontWeight: 550 }}>Hide from reports and budgets</strong>
                The entry stays in your ledger and account balance but is left out of cash-flow, spending, and budget calculations.
              </span>
            </label>

            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={isTransfer ? 'Delete this transfer?' : 'Delete this transaction?'}
        confirmLabel={isTransfer ? 'Delete transfer' : 'Delete transaction'}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        description={
          isTransfer
            ? 'Both linked entries will be removed from their accounts. This cannot be undone.'
            : 'The entry and its splits will be removed. This cannot be undone.'
        }
      />
    </>
  );
}

export function TransferDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
}) {
  const { user } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => todayISO(user?.timezone || 'UTC'));
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFromAccountId(accounts[0]?.id ?? '');
    setToAccountId(accounts[1]?.id ?? '');
    setAmount('');
    setDate(todayISO(user?.timezone || 'UTC'));
    setDescription('');
    setNotes('');
    setError('');
  }, [open, accounts, user?.timezone]);

  const create = useMutation({
    mutationFn: async () => {
      const cents = moneyInputToCents(amount);
      if (!fromAccountId || !toAccountId) throw new Error('Choose both accounts.');
      if (fromAccountId === toAccountId) throw new Error('Choose two different accounts.');
      if (cents <= 0) throw new Error('Enter a transfer amount greater than zero.');
      return api.createTransfer({
        fromAccountId,
        toAccountId,
        amountCents: cents,
        date,
        description: description.trim() || undefined,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success('Transfer recorded in both accounts.');
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      onOpenChange(false);
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'The transfer could not be recorded.'),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Move money between accounts"
      description="Transfers create a linked pair of entries and are excluded from income, spending, and budgets."
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Spinner label="Recording transfer" /> : null} Record transfer
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="From account" htmlFor="transfer-from">
          <div className="select-wrap">
            <select id="transfer-from" className="select" value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}>
              {accounts.filter((account) => !account.archived).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="To account" htmlFor="transfer-to">
          <div className="select-wrap">
            <select id="transfer-to" className="select" value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
              {accounts.filter((account) => !account.archived).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Amount" htmlFor="transfer-amount">
          <input id="transfer-amount" className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Date" htmlFor="transfer-date">
          <input id="transfer-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Description" htmlFor="transfer-description" className="full">
          <input id="transfer-description" className="input" placeholder="Transfer between accounts" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
        </Field>
        <Field label="Notes" htmlFor="transfer-notes" className="full">
          <textarea id="transfer-notes" className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} />
        </Field>
        {error ? <p className="form-error full" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
