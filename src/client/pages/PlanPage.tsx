import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Target, Trash2, WalletCards } from 'lucide-react';
import type { Budget, Category, Goal } from '../../shared/types';
import { api } from '../lib/api';
import { centsToInput, currentMonth, moneyInputToCents, monthLabel, percent, shiftMonth } from '../lib/finance';
import { useFormatDate, useMoney } from '../lib/session';
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

type Tab = 'budgets' | 'goals';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'budgets', label: 'Budgets' },
  { id: 'goals', label: 'Goals' },
];

const GOAL_COLORS = [
  'oklch(0.72 0.13 170)',
  'oklch(0.55 0.12 155)',
  'oklch(0.62 0.12 45)',
  'oklch(0.60 0.10 240)',
  'oklch(0.70 0.12 85)',
  'oklch(0.58 0.11 320)',
];

function parseTab(value: string | null): Tab {
  return value === 'goals' ? 'goals' : 'budgets';
}

function isMonth(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

export function PlanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const formatDate = useFormatDate();
  const tab = parseTab(searchParams.get('tab'));
  const month = isMonth(searchParams.get('month')) ? searchParams.get('month')! : currentMonth();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<Budget | null>(null);
  const [budgetDelete, setBudgetDelete] = useState<Budget | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalEdit, setGoalEdit] = useState<Goal | null>(null);
  const [goalDelete, setGoalDelete] = useState<Goal | null>(null);
  const [goalDetail, setGoalDetail] = useState<Goal | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });
  const budgets = useQuery({ queryKey: ['budgets', month], queryFn: () => api.budgets(month) });
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals });

  const activeCategories = (categories.data?.categories ?? []).filter((category) => !category.archived);
  const expenseCategories = activeCategories.filter((category) => category.kind === 'expense');
  const budgetRows = budgets.data?.budgets ?? [];
  const goalRows = goals.data?.goals ?? [];

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'budgets') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const setMonth = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === currentMonth()) params.delete('month');
    else params.set('month', next);
    setSearchParams(params, { replace: true });
  };

  const invalidateBudgets = () => {
    void queryClient.invalidateQueries({ queryKey: ['budgets'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const invalidateGoals = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
  };

  const saveBudget = useMutation({
    mutationFn: (input: { id?: string; categoryId: string; amountCents: number; alertThreshold: number }) =>
      input.id
        ? api.updateBudget(input.id, { amountCents: input.amountCents, alertThreshold: input.alertThreshold })
        : api.createBudget({ categoryId: input.categoryId, month, amountCents: input.amountCents, alertThreshold: input.alertThreshold }),
    onSuccess: (_result, input) => {
      toast.success(input.id ? 'Budget updated.' : 'Budget added for this month.');
      setBudgetOpen(false);
      setBudgetEdit(null);
      invalidateBudgets();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The budget could not be saved.'),
  });

  const removeBudget = useMutation({
    mutationFn: (id: string) => api.deleteBudget(id),
    onSuccess: () => {
      toast.success('Budget removed.');
      setBudgetDelete(null);
      invalidateBudgets();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The budget could not be removed.'),
  });

  const copyBudgets = useMutation({
    mutationFn: () => api.copyBudgets(shiftMonth(month, -1), month),
    onSuccess: (result) => {
      toast.success(
        result.copied
          ? `${result.copied} budget${result.copied === 1 ? '' : 's'} copied into ${monthLabel(month)}.`
          : 'Every category already has a budget for this month, or last month had none.',
      );
      invalidateBudgets();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Budgets could not be copied.'),
  });

  const saveGoal = useMutation({
    mutationFn: (input: { id?: string; name: string; targetCents: number; targetDate: string | null; color: string }) =>
      input.id
        ? api.updateGoal(input.id, { name: input.name, targetCents: input.targetCents, targetDate: input.targetDate, color: input.color })
        : api.createGoal({ name: input.name, targetCents: input.targetCents, targetDate: input.targetDate, color: input.color }),
    onSuccess: (_result, input) => {
      toast.success(input.id ? 'Goal updated.' : 'Goal created.');
      setGoalOpen(false);
      setGoalEdit(null);
      invalidateGoals();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The goal could not be saved.'),
  });

  const removeGoal = useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: () => {
      toast.success('Goal deleted.');
      setGoalDelete(null);
      invalidateGoals();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The goal could not be deleted.'),
  });

  const budgetTotals = useMemo(() => {
    const planned = budgetRows.reduce((sum, row) => sum + row.amountCents, 0);
    const spent = budgetRows.reduce((sum, row) => sum + row.spentCents, 0);
    return { planned, spent, remaining: planned - spent };
  }, [budgetRows]);

  const savedTotal = goalRows.reduce((sum, goal) => sum + Math.max(0, goal.currentCents), 0);
  const currentMonthLabel = monthLabel(month);

  return (
    <div className="page">
      <PageHead
        title="Plan"
        sub={
          <>
            Set the shape of the month and fund what matters. Budgets track spending; goals track what you are setting aside.
          </>
        }
        actions={
          tab === 'budgets' ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => copyBudgets.mutate()}
                disabled={copyBudgets.isPending || !budgetRows.length}
                title="Copy last month's budgets into this month"
              >
                {copyBudgets.isPending ? <Spinner label="Copying budgets" /> : <Copy size={14} />}
                <span className="btn-label">Copy last month</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={() => { setBudgetEdit(null); setBudgetOpen(true); }}>
                <Plus size={15} /> <span className="btn-label">Add budget</span>
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => { setGoalEdit(null); setGoalOpen(true); }}>
              <Plus size={15} /> <span className="btn-label">New goal</span>
            </button>
          )
        }
      />

      <div className="tabs" role="tablist" aria-label="Planning views">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className="tab"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'goals' && goalRows.length ? <span className="badge">{goalRows.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'budgets' ? (
        <div className="section-gap" role="tabpanel" aria-label="Budgets">
          <div className="plan-toolbar">
            <div className="month-nav">
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronLeft size={16} />
              </button>
              <div>
                <div className="month-nav-label">{currentMonthLabel}</div>
                <div className="hint">{month === currentMonth() ? 'This month' : 'Monthly plan'}</div>
              </div>
              <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight size={16} />
              </button>
              {month !== currentMonth() ? (
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => setMonth(currentMonth())}>Today</button>
              ) : null}
            </div>
            <StatusPill tone="accent">{budgetRows.length} budget{budgetRows.length === 1 ? '' : 's'} set</StatusPill>
          </div>

          <section className="plan-summary" aria-label="Budget totals">
            <div className="plan-metric">
              <span>Planned</span>
              <strong>{money(budgetTotals.planned)}</strong>
              <small>{budgetRows.length} categor{budgetRows.length === 1 ? 'y' : 'ies'} budgeted</small>
            </div>
            <div className="plan-metric">
              <span>Spent</span>
              <strong className={budgetTotals.spent > budgetTotals.planned && budgetTotals.planned > 0 ? 'negative' : ''}>{money(budgetTotals.spent)}</strong>
              <small>{budgetTotals.planned ? `${Math.round(percent(budgetTotals.spent, budgetTotals.planned))}% of plan used` : 'No budget set yet'}</small>
            </div>
            <div className="plan-metric">
              <span>Remaining</span>
              <strong className={budgetTotals.remaining < 0 ? 'negative' : 'positive'}>{money(budgetTotals.remaining, { signed: true })}</strong>
              <small>Across this month's categories</small>
            </div>
            <div className="plan-metric">
              <span>Goals funded</span>
              <strong>{money(savedTotal)}</strong>
              <small>{goalRows.length} savings goal{goalRows.length === 1 ? '' : 's'}</small>
            </div>
          </section>

          <div className="plan-grid">
            <section className="card card-pad" aria-labelledby="budget-title">
              <div className="section-head">
                <h2 id="budget-title" className="section-title">By category</h2>
                <span className="hint">{monthLabel(month)}</span>
              </div>
              {budgets.isError ? (
                <ErrorState message={budgets.error instanceof Error ? budgets.error.message : undefined} onRetry={() => void budgets.refetch()} />
              ) : budgets.isLoading ? (
                <LoadingBlock lines={5} label="Loading budgets" />
              ) : budgetRows.length ? (
                <div className="budget-list">
                  {budgetRows.map((budget) => {
                    const used = percent(budget.spentCents, budget.amountCents);
                    const over = budget.spentCents > budget.amountCents;
                    const warn = !over && used >= budget.alertThreshold;
                    return (
                      <div className="budget-row" key={budget.id}>
                        <div className="budget-line">
                          <strong>
                            <span className="cat-dot" style={{ background: budget.categoryColor, display: 'inline-block', marginRight: 8 }} />
                            {budget.categoryName}
                          </strong>
                          <span className="num">
                            {money(budget.spentCents)} <span className="faint">of {money(budget.amountCents)}</span>
                          </span>
                        </div>
                        <div className={`progress ${over ? 'over' : warn ? 'warn' : ''}`} role="progressbar" aria-label={`${budget.categoryName} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(used))}>
                          <span style={{ width: `${Math.min(100, Math.max(1, used))}%` }} />
                        </div>
                        <div className="budget-foot">
                          <span>
                            {over
                              ? `${money(budget.spentCents - budget.amountCents)} over budget`
                              : `${money(budget.amountCents - budget.spentCents)} left`}
                            {warn && !over ? ` · past the ${budget.alertThreshold}% alert line` : ''}
                          </span>
                          <span className="simple-row-side">
                            <span>{Math.round(used)}%</span>
                            <button type="button" className="icon-btn" aria-label={`Edit ${budget.categoryName} budget`} onClick={() => { setBudgetEdit(budget); setBudgetOpen(true); }}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" className="icon-btn" aria-label={`Delete ${budget.categoryName} budget`} onClick={() => setBudgetDelete(budget)}>
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<WalletCards size={16} />}
                  title="No budgets for this month"
                  copy="Give each spending category a ceiling. Percent-used warnings appear as you approach it."
                  action={
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setBudgetOpen(true)}>Add a budget</button>
                      <button type="button" className="btn btn-sm" onClick={() => copyBudgets.mutate()} disabled={copyBudgets.isPending}>
                        Copy last month
                      </button>
                    </div>
                  }
                />
              )}
            </section>

            <div className="plan-side">
              <section className="card card-pad">
                <div className="section-head">
                  <h2 className="section-title">Budget health</h2>
                </div>
                <div className="budget-health">
                  <div>
                    <span>Over budget</span>
                    <strong className={budgetRows.some((row) => row.spentCents > row.amountCents) ? 'negative' : ''}>
                      {budgetRows.filter((row) => row.spentCents > row.amountCents).length}
                    </strong>
                  </div>
                  <div>
                    <span>Near limit</span>
                    <strong>{budgetRows.filter((row) => row.spentCents <= row.amountCents && percent(row.spentCents, row.amountCents) >= row.alertThreshold).length}</strong>
                  </div>
                  <div>
                    <span>On pace</span>
                    <strong>{budgetRows.filter((row) => percent(row.spentCents, row.amountCents) < row.alertThreshold).length}</strong>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'goals' ? (
        <div className="section-gap" role="tabpanel" aria-label="Goals">
          {goals.isError ? (
            <ErrorState message={goals.error instanceof Error ? goals.error.message : undefined} onRetry={() => void goals.refetch()} />
          ) : goals.isLoading ? (
            <LoadingBlock lines={4} label="Loading goals" />
          ) : goalRows.length ? (
            <>
              <div className="goal-summary-line">
                <p className="muted" style={{ margin: 0 }}>
                  <strong>{money(savedTotal)}</strong> set aside toward {money(goalRows.reduce((sum, goal) => sum + goal.targetCents, 0))} in goals.
                </p>
                <span className="hint">{goalRows.filter((goal) => goal.currentCents >= goal.targetCents).length} complete</span>
              </div>
              <div className="goal-grid">
                {goalRows.map((goal) => {
                  const share = percent(goal.currentCents, goal.targetCents);
                  const remaining = Math.max(0, goal.targetCents - goal.currentCents);
                  const done = goal.currentCents >= goal.targetCents;
                  return (
                    <article className="goal-card" key={goal.id}>
                      <div className="goal-top">
                        <div>
                          <h2 className="goal-name">{goal.name}</h2>
                          <p className="goal-target">
                            {goal.targetDate ? `Target ${formatDate(goal.targetDate, 'long')}` : 'No target date'}
                            {done ? ' · Funded' : ''}
                          </p>
                        </div>
                        <GoalRing value={goal.currentCents} target={goal.targetCents} color={goal.color} />
                      </div>
                      <div className="goal-value">
                        {money(goal.currentCents)} <small>of {money(goal.targetCents)}</small>
                      </div>
                      <div className={`progress ${done ? '' : share > 80 ? 'warn' : ''}`} role="progressbar" aria-label={`${goal.name} funding progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
                        <span style={{ width: `${Math.max(1, Math.min(100, share))}%`, background: goal.color }} />
                      </div>
                      <div className="goal-actions">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setGoalDetail(goal)}>
                          <Plus size={13} /> {done ? 'Adjust' : 'Add money'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setGoalDetail(goal)}>History</button>
                        <button type="button" className="icon-btn" aria-label={`Edit ${goal.name}`} onClick={() => { setGoalEdit(goal); setGoalOpen(true); }}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Delete ${goal.name}`} onClick={() => setGoalDelete(goal)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="hint" style={{ marginTop: 9 }}>
                        {done ? 'Fully funded. Withdrawals still appear in the history.' : `${money(remaining)} to go.`}
                      </p>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <section className="card card-pad">
              <EmptyState
                icon={<Target size={16} />}
                title="No savings goals yet"
                copy="Name the thing you are saving for, set the number, and watch the ring close. Contributions are logged with optional notes."
                action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setGoalOpen(true)}>Create a goal</button>}
              />
            </section>
          )}
        </div>
      ) : null}

      {budgetOpen ? (
        <BudgetDialog
          month={month}
          budget={budgetEdit}
          categories={expenseCategories}
          existing={budgetRows}
          busy={saveBudget.isPending}
          onClose={() => { setBudgetOpen(false); setBudgetEdit(null); }}
          onSave={(input) => saveBudget.mutate(input)}
        />
      ) : null}

      {goalOpen ? (
        <GoalDialog
          goal={goalEdit}
          busy={saveGoal.isPending}
          onClose={() => { setGoalOpen(false); setGoalEdit(null); }}
          onSave={(input) => saveGoal.mutate(input)}
        />
      ) : null}

      {goalDetail ? (
        <GoalDetailDialog
          goal={goalDetail}
          onClose={() => setGoalDetail(null)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['goal-contributions', goalDetail.id] });
            invalidateGoals();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!budgetDelete}
        onOpenChange={(open) => { if (!open) setBudgetDelete(null); }}
        title="Remove this budget?"
        confirmLabel="Remove budget"
        busy={removeBudget.isPending}
        onConfirm={() => budgetDelete && removeBudget.mutate(budgetDelete.id)}
        description={budgetDelete ? `The ${budgetDelete.categoryName} budget for ${monthLabel(budgetDelete.month)} will be removed. Transactions and spending history stay untouched.` : ''}
      />

      <ConfirmDialog
        open={!!goalDelete}
        onOpenChange={(open) => { if (!open) setGoalDelete(null); }}
        title="Delete this goal?"
        confirmLabel="Delete goal"
        busy={removeGoal.isPending}
        onConfirm={() => goalDelete && removeGoal.mutate(goalDelete.id)}
        description={goalDelete ? `“${goalDelete.name}” and its contribution history will be deleted. This cannot be undone.` : ''}
      />
    </div>
  );
}

function GoalRing({ value, target, color }: { value: number; target: number; color: string }) {
  const share = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  const circumference = 2 * Math.PI * 19;
  return (
    <svg className="goal-ring" viewBox="0 0 46 46" role="img" aria-label={`${Math.round(share * 100)} percent funded`} style={{ '--goal-color': color } as CSSProperties}>
      <circle className="ring-track" cx="23" cy="23" r="19" />
      <circle
        className="ring-value"
        cx="23"
        cy="23"
        r="19"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - share)}
      />
      <text x="23" y="26">{Math.round(share * 100)}%</text>
    </svg>
  );
}

function BudgetDialog({
  month,
  budget,
  categories,
  existing,
  busy,
  onClose,
  onSave,
}: {
  month: string;
  budget: Budget | null;
  categories: Category[];
  existing: Budget[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; categoryId: string; amountCents: number; alertThreshold: number }) => void;
}) {
  const usedCategoryIds = new Set(existing.map((row) => row.categoryId));
  const options = budget ? categories : categories.filter((category) => !usedCategoryIds.has(category.id));
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? options[0]?.id ?? '');
  const [amount, setAmount] = useState(budget ? centsToInput(budget.amountCents) : '');
  const [threshold, setThreshold] = useState(String(budget?.alertThreshold ?? 80));
  const [error, setError] = useState('');
  const cents = moneyInputToCents(amount);
  const thresholdNumber = Number.parseInt(threshold, 10);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!categoryId) return setError('Choose a category.');
    if (!Number.isSafeInteger(cents) || cents <= 0) return setError('Enter a monthly amount greater than zero.');
    if (!Number.isFinite(thresholdNumber) || thresholdNumber < 1 || thresholdNumber > 100) return setError('The alert threshold must be between 1 and 100.');
    onSave({ id: budget?.id, categoryId, amountCents: cents, alertThreshold: thresholdNumber });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={budget ? `Edit ${budget.categoryName} budget` : 'Add a budget'}
      description={`${monthLabel(month)} · spending ceiling and alert line`}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="budget-form" className="btn btn-primary" disabled={busy || !options.length}>
            {busy ? <Spinner label="Saving budget" /> : null} Save budget
          </button>
        </>
      }
    >
      <form id="budget-form" className="form-grid" onSubmit={submit}>
        <Field label="Category" htmlFor="budget-category" className="full">
          <span className="select-wrap">
            <select
              id="budget-category"
              className="select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              disabled={!!budget}
            >
              {!options.length ? <option value="">Every expense category already has a budget</option> : null}
              {options.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </span>
        </Field>
        <Field label="Monthly amount" htmlFor="budget-amount" hint="In your display currency.">
          <div className="amount-row">
            <input
              id="budget-amount"
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setError(''); }}
              aria-invalid={!!error}
            />
            <span className="sign-toggle" aria-hidden="true"><button type="button" data-active="false" tabIndex={-1}>−</button></span>
          </div>
        </Field>
        <Field label="Alert at" htmlFor="budget-threshold" hint="Percent of the budget used.">
          <input
            id="budget-threshold"
            className="input"
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(event) => { setThreshold(event.target.value); setError(''); }}
          />
        </Field>
        {error ? <p className="form-error full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

function GoalDialog({
  goal,
  busy,
  onClose,
  onSave,
}: {
  goal: Goal | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; name: string; targetCents: number; targetDate: string | null; color: string }) => void;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetCents) : '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [color, setColor] = useState(goal?.color ?? GOAL_COLORS[0]!);
  const [error, setError] = useState('');
  const cents = moneyInputToCents(target);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the goal a name.');
    if (!Number.isSafeInteger(cents) || cents <= 0) return setError('Enter a target greater than zero.');
    onSave({ id: goal?.id, name: name.trim(), targetCents: cents, targetDate: targetDate || null, color });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={goal ? 'Edit goal' : 'New savings goal'}
      description="A target, an optional date, and a color for the ring."
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="goal-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner label="Saving goal" /> : null} Save goal
          </button>
        </>
      }
    >
      <form id="goal-form" className="form-grid" onSubmit={submit}>
        <Field label="Goal name" htmlFor="goal-name" className="full">
          <input id="goal-name" className="input" value={name} maxLength={80} placeholder="Emergency fund" onChange={(event) => { setName(event.target.value); setError(''); }} />
        </Field>
        <Field label="Target amount" htmlFor="goal-target">
          <input id="goal-target" className="input" inputMode="decimal" placeholder="0.00" value={target} onChange={(event) => { setTarget(event.target.value); setError(''); }} aria-invalid={!!error} />
        </Field>
        <Field label="Target date" hint="Optional." htmlFor="goal-date">
          <input id="goal-date" className="input" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </Field>
        <div className="field full">
          <span className="label">Ring color</span>
          <div className="color-swatches" role="group" aria-label="Goal color">
            {GOAL_COLORS.map((option) => (
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

function GoalDetailDialog({ goal, onClose, onChanged }: { goal: Goal; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const money = useMoney();
  const formatDate = useFormatDate();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'add' | 'withdraw'>('add');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const contributions = useQuery({
    queryKey: ['goal-contributions', goal.id],
    queryFn: () => api.contributions(goal.id),
  });
  const add = useMutation({
    mutationFn: () => {
      const cents = moneyInputToCents(amount);
      if (!Number.isSafeInteger(cents) || cents === 0) throw new Error('Enter an amount greater than zero.');
      return api.contribute(goal.id, {
        amountCents: direction === 'withdraw' ? -Math.abs(cents) : Math.abs(cents),
        note: note.trim() || null,
        contributedAt: date || undefined,
      });
    },
    onSuccess: () => {
      toast.success(direction === 'withdraw' ? 'Withdrawal recorded.' : 'Contribution added.');
      setAmount('');
      setNote('');
      setError('');
      onChanged();
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'The contribution could not be saved.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeContribution(goal.id, id),
    onSuccess: () => {
      toast.success('Contribution removed.');
      onChanged();
    },
    onError: (caught) => toast.error(caught instanceof Error ? caught.message : 'The contribution could not be removed.'),
  });

  const rows = contributions.data?.contributions ?? [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const cents = moneyInputToCents(amount);
    if (!Number.isSafeInteger(cents) || cents <= 0) return setError('Enter an amount greater than zero.');
    add.mutate();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={goal.name}
      description={`${money(goal.currentCents)} of ${money(goal.targetCents)} funded${goal.targetDate ? ` · target ${formatDate(goal.targetDate, 'long')}` : ''}`}
      wide
      footer={<button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${Math.max(1, percent(goal.currentCents, goal.targetCents))}%`, background: goal.color }} />
        </div>
        <form className="goal-contribution-form" onSubmit={submit}>
          <div className="segmented" role="group" aria-label="Contribution direction">
            <button type="button" aria-pressed={direction === 'add'} onClick={() => setDirection('add')}>Add</button>
            <button type="button" aria-pressed={direction === 'withdraw'} onClick={() => setDirection('withdraw')}>Withdraw</button>
          </div>
          <input className="input" inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => { setAmount(event.target.value); setError(''); }} aria-label="Contribution amount" />
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Contribution date" />
          <input className="input" placeholder="Note (optional)" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} aria-label="Contribution note" />
          <button type="submit" className="btn btn-primary" disabled={add.isPending}>
            {add.isPending ? <Spinner label="Recording contribution" /> : <Plus size={14} />} Record
          </button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div>
          <div className="section-head">
            <h3 className="section-title">Contribution history</h3>
            <span className="hint">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}</span>
          </div>
          {contributions.isError ? (
            <ErrorState message={contributions.error instanceof Error ? contributions.error.message : undefined} onRetry={() => void contributions.refetch()} />
          ) : contributions.isLoading ? (
            <LoadingBlock lines={3} label="Loading contributions" />
          ) : rows.length ? (
            <div className="simple-list">
              {rows.map((row) => (
                <div className="simple-row" key={row.id}>
                  <div className="simple-row-main">
                    <div className="simple-row-title">{formatDate(row.contributedAt, 'long')}</div>
                    <div className="simple-row-sub">{row.note || 'No note'}</div>
                  </div>
                  <div className="simple-row-side">
                    <span className={`num ${row.amountCents < 0 ? 'negative' : 'positive'}`}>{money(row.amountCents, { signed: true })}</span>
                    <button type="button" className="icon-btn" aria-label="Remove contribution" onClick={() => remove.mutate(row.id)} disabled={remove.isPending}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No contributions yet" copy="Add the first contribution above. Withdrawals are stored as negative entries." />
          )}
        </div>
      </div>
    </Modal>
  );
}
