import type { SqlClient } from '../db/sql';
import { isUniqueViolation } from '../db/sql';
import type { Budget, Goal } from '../../shared/types';
import { randomToken } from '../security/crypto';
import { Errors } from '../errors';
import { endOfMonth, isValidISODate } from '../../shared/dates';

interface BudgetRow {
  id: string;
  category_id: string;
  category_name: string;
  category_color: string;
  month: string;
  amount_cents: number;
  alert_threshold: number;
  spent_cents: number;
}

export class BudgetService {
  constructor(private readonly client: SqlClient) {}

  async list(month: string): Promise<Budget[]> {
    this.validateMonth(month);
    const from = `${month}-01`;
    const to = endOfMonth(from);
    const rows = (await this.client
      .prepare(
        `SELECT b.id, b.category_id, c.name AS category_name, c.color AS category_color,
           b.month, b.amount_cents, b.alert_threshold,
           COALESCE((
             SELECT SUM(-a.allocation_amount_cents) FROM transaction_allocations a
             WHERE a.category_id = b.category_id
               AND a.txn_date BETWEEN ? AND ? AND a.allocation_amount_cents < 0
               AND a.is_transfer = 0 AND a.excluded_from_reports = 0
           ), 0) AS spent_cents
         FROM budgets b JOIN categories c ON c.id = b.category_id
         WHERE b.month = ?
         ORDER BY c.name ASC`,
      )
      .all(from, to, month)) as BudgetRow[];
    return rows.map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryColor: row.category_color,
      month: row.month,
      amountCents: row.amount_cents,
      spentCents: row.spent_cents,
      alertThreshold: row.alert_threshold,
    }));
  }

  private validateMonth(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) throw Errors.badRequest('Month must use YYYY-MM.');
    if (!isValidISODate(`${month}-01`)) throw Errors.badRequest('Month must be a real calendar month.');
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const row = await this.client.prepare('SELECT id FROM categories WHERE id = ? AND archived = 0').get(categoryId);
    if (!row) throw Errors.badRequest('Choose one of your active categories.');
  }

  async create(input: {
    categoryId: string;
    month: string;
    amountCents: number;
    alertThreshold?: number;
  }): Promise<Budget> {
    this.validateMonth(input.month);
    await this.assertCategory(input.categoryId);
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw Errors.badRequest('Budget must be a positive whole-cent amount.');
    }
    const threshold = input.alertThreshold ?? 80;
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      throw Errors.badRequest('Alert threshold must be between 1 and 100.');
    }
    const id = randomToken(18);
    const now = new Date().toISOString();
    try {
      await this.client
        .prepare(
          `INSERT INTO budgets (id, category_id, month, amount_cents, alert_threshold, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.categoryId, input.month, input.amountCents, threshold, now, now);
    } catch (error) {
      if (isUniqueViolation(error)) throw Errors.conflict('A budget already exists for that category and month.');
      throw error;
    }
    return (await this.list(input.month)).find((budget) => budget.id === id)!;
  }

  async update(
    budgetId: string,
    patch: { amountCents?: number; alertThreshold?: number },
  ): Promise<Budget> {
    const existing = (await this.client.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId)) as
      | { month: string; amount_cents: number; alert_threshold: number }
      | undefined;
    if (!existing) throw Errors.notFound('Budget not found.');
    if (patch.amountCents !== undefined && (!Number.isSafeInteger(patch.amountCents) || patch.amountCents <= 0)) {
      throw Errors.badRequest('Budget must be a positive whole-cent amount.');
    }
    if (
      patch.alertThreshold !== undefined &&
      (!Number.isInteger(patch.alertThreshold) || patch.alertThreshold < 1 || patch.alertThreshold > 100)
    ) {
      throw Errors.badRequest('Alert threshold must be between 1 and 100.');
    }
    await this.client
      .prepare('UPDATE budgets SET amount_cents = ?, alert_threshold = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.amountCents ?? existing.amount_cents,
        patch.alertThreshold ?? existing.alert_threshold,
        new Date().toISOString(),
        budgetId,
      );
    return (await this.list(existing.month)).find((budget) => budget.id === budgetId)!;
  }

  async delete(budgetId: string): Promise<void> {
    const result = await this.client.prepare('DELETE FROM budgets WHERE id = ?').run(budgetId);
    if (!result.changes) throw Errors.notFound('Budget not found.');
  }

  async copy(fromMonth: string, toMonth: string): Promise<number> {
    this.validateMonth(fromMonth);
    this.validateMonth(toMonth);
    if (fromMonth === toMonth) throw Errors.badRequest('Choose a different target month.');
    const budgets = await this.list(fromMonth);
    const now = new Date().toISOString();
    let copied = 0;
    await this.client.transaction(async () => {
      for (const budget of budgets) {
        const result = await this.client
          .prepare(
            `INSERT INTO budgets (id, category_id, month, amount_cents, alert_threshold, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (category_id, month) DO NOTHING`,
          )
          .run(randomToken(18), budget.categoryId, toMonth, budget.amountCents, budget.alertThreshold, now, now);
        copied += result.changes;
      }
    });
    return copied;
  }
}

interface GoalRow {
  id: string;
  name: string;
  target_cents: number;
  target_date: string | null;
  color: string;
  created_at: string;
  current_cents: number;
}

export class GoalService {
  constructor(private readonly client: SqlClient) {}

  async list(): Promise<Goal[]> {
    const rows = (await this.client
      .prepare(
        `SELECT g.*, COALESCE((
           SELECT SUM(amount_cents) FROM goal_contributions c WHERE c.goal_id = g.id
         ), 0) AS current_cents
         FROM goals g ORDER BY g.created_at ASC`,
      )
      .all()) as GoalRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      targetCents: row.target_cents,
      currentCents: row.current_cents,
      targetDate: row.target_date,
      color: row.color,
      createdAt: row.created_at,
    }));
  }

  async create(input: {
    name: string;
    targetCents: number;
    targetDate?: string | null;
    color?: string;
  }): Promise<Goal> {
    if (!input.name?.trim() || input.name.trim().length > 80) {
      throw Errors.badRequest('Goal name must be 1–80 characters.');
    }
    if (!Number.isSafeInteger(input.targetCents) || input.targetCents <= 0) {
      throw Errors.badRequest('Goal target must be a positive whole-cent amount.');
    }
    if (input.targetDate && !isValidISODate(input.targetDate)) throw Errors.badRequest('Target date is invalid.');
    const id = randomToken(18);
    const now = new Date().toISOString();
    await this.client
      .prepare(
        `INSERT INTO goals (id, name, target_cents, target_date, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim().slice(0, 80),
        input.targetCents,
        input.targetDate ?? null,
        input.color ?? 'oklch(0.72 0.13 170)',
        now,
        now,
      );
    return (await this.list()).find((goal) => goal.id === id)!;
  }

  async update(
    goalId: string,
    patch: { name?: string; targetCents?: number; targetDate?: string | null; color?: string },
  ): Promise<Goal> {
    const existing = (await this.client.prepare('SELECT * FROM goals WHERE id = ?').get(goalId)) as
      | { name: string; target_cents: number; target_date: string | null; color: string }
      | undefined;
    if (!existing) throw Errors.notFound('Goal not found.');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 80)) {
      throw Errors.badRequest('Goal name must be 1–80 characters.');
    }
    if (patch.targetCents !== undefined && (!Number.isSafeInteger(patch.targetCents) || patch.targetCents <= 0)) {
      throw Errors.badRequest('Goal target must be positive.');
    }
    if (patch.targetDate && !isValidISODate(patch.targetDate)) throw Errors.badRequest('Target date is invalid.');
    await this.client
      .prepare('UPDATE goals SET name = ?, target_cents = ?, target_date = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name?.trim() ?? existing.name,
        patch.targetCents ?? existing.target_cents,
        patch.targetDate !== undefined ? patch.targetDate : existing.target_date,
        patch.color ?? existing.color,
        new Date().toISOString(),
        goalId,
      );
    return (await this.list()).find((goal) => goal.id === goalId)!;
  }

  async delete(goalId: string): Promise<void> {
    const result = await this.client.prepare('DELETE FROM goals WHERE id = ?').run(goalId);
    if (!result.changes) throw Errors.notFound('Goal not found.');
  }

  async contribute(
    goalId: string,
    input: { amountCents: number; note?: string | null; contributedAt?: string },
  ): Promise<Goal> {
    const goal = await this.client.prepare('SELECT id FROM goals WHERE id = ?').get(goalId);
    if (!goal) throw Errors.notFound('Goal not found.');
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) {
      throw Errors.badRequest('Contribution must be a non-zero whole-cent amount.');
    }
    const contributedAt = input.contributedAt ?? new Date().toISOString().slice(0, 10);
    if (!isValidISODate(contributedAt)) throw Errors.badRequest('Contribution date is invalid.');
    await this.client
      .prepare(
        `INSERT INTO goal_contributions (id, goal_id, amount_cents, note, contributed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomToken(18),
        goalId,
        input.amountCents,
        input.note?.trim().slice(0, 1000) || null,
        contributedAt,
        new Date().toISOString(),
      );
    return (await this.list()).find((item) => item.id === goalId)!;
  }

  async contributions(
    goalId: string,
  ): Promise<Array<{ id: string; amountCents: number; note: string | null; contributedAt: string }>> {
    const goal = await this.client.prepare('SELECT id FROM goals WHERE id = ?').get(goalId);
    if (!goal) throw Errors.notFound('Goal not found.');
    const rows = (await this.client
      .prepare(
        'SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY contributed_at DESC, created_at DESC LIMIT 200',
      )
      .all(goalId)) as Array<{ id: string; amount_cents: number; note: string | null; contributed_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      note: row.note,
      contributedAt: row.contributed_at,
    }));
  }

  async removeContribution(goalId: string, contributionId: string): Promise<void> {
    const result = await this.client
      .prepare('DELETE FROM goal_contributions WHERE id = ? AND goal_id = ?')
      .run(contributionId, goalId);
    if (!result.changes) throw Errors.notFound('Contribution not found.');
  }
}
