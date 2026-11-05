import type { SqlClient } from '../db/sql';
import { isUniqueViolation } from '../db/sql';
import { randomToken } from '../security/crypto';
import { Errors } from '../errors';
import type { Account, Category } from '../../shared/types';

const ACCOUNT_TYPES = new Set(['checking', 'savings', 'credit', 'cash', 'investment']);

export class AccountService {
  constructor(private readonly client: SqlClient) {}

  async list(includeArchived = false, onlyId?: string): Promise<Account[]> {
    const rows = (await this.client
      .prepare(
        `SELECT a.*,
          a.opening_balance_cents + COALESCE((
            SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = a.id
          ), 0) AS current_balance_cents
         FROM accounts a
         WHERE ${includeArchived ? '1 = 1' : 'a.archived = 0'}${onlyId ? ' AND a.id = ?' : ''}
         ORDER BY a.archived ASC, a.created_at ASC`,
      )
      .all(...(onlyId ? [onlyId] : []))) as Array<{
      id: string;
      name: string;
      type: Account['type'];
      institution: string | null;
      currency: string;
      opening_balance_cents: number;
      current_balance_cents: number;
      color: string;
      archived: number;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      institution: row.institution,
      currency: row.currency,
      openingBalanceCents: row.opening_balance_cents,
      currentBalanceCents: row.current_balance_cents,
      color: row.color,
      archived: row.archived === 1,
      createdAt: row.created_at,
    }));
  }

  async get(accountId: string): Promise<Account | null> {
    return (await this.list(true, accountId))[0] ?? null;
  }

  async create(
    userCurrency: string,
    input: {
      name: string;
      type: string;
      institution?: string | null;
      openingBalanceCents?: number;
      color?: string;
    },
  ): Promise<Account> {
    if (!input.name?.trim() || input.name.trim().length > 80) throw Errors.badRequest('Account name must be 1–80 characters.');
    if (!ACCOUNT_TYPES.has(input.type)) throw Errors.badRequest('Choose a valid account type.');
    if (!Number.isSafeInteger(input.openingBalanceCents ?? 0)) throw Errors.badRequest('Opening balance must be integer cents.');
    const id = randomToken(18);
    const now = new Date().toISOString();
    await this.client
      .prepare(
        `INSERT INTO accounts (id, name, type, institution, currency, opening_balance_cents, color, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.type,
        input.institution?.trim().slice(0, 100) ?? null,
        userCurrency,
        input.openingBalanceCents ?? 0,
        input.color ?? 'oklch(0.7 0.08 220)',
        now,
        now,
      );
    return (await this.get(id))!;
  }

  async update(
    accountId: string,
    patch: {
      name?: string;
      type?: string;
      institution?: string | null;
      openingBalanceCents?: number;
      color?: string;
      archived?: boolean;
    },
  ): Promise<Account> {
    const existing = (await this.client.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)) as
      | { name: string; type: string; institution: string | null; opening_balance_cents: number; color: string; archived: number }
      | undefined;
    if (!existing) throw Errors.notFound('Account not found.');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 80)) throw Errors.badRequest('Account name must be 1–80 characters.');
    if (patch.type !== undefined && !ACCOUNT_TYPES.has(patch.type)) throw Errors.badRequest('Choose a valid account type.');
    if (patch.openingBalanceCents !== undefined && !Number.isSafeInteger(patch.openingBalanceCents)) throw Errors.badRequest('Opening balance must be integer cents.');
    await this.client
      .prepare(
        `UPDATE accounts SET name = ?, type = ?, institution = ?, opening_balance_cents = ?, color = ?, archived = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name?.trim() ?? existing.name,
        patch.type ?? existing.type,
        patch.institution !== undefined ? patch.institution?.trim().slice(0, 100) ?? null : existing.institution,
        patch.openingBalanceCents ?? existing.opening_balance_cents,
        patch.color ?? existing.color,
        patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
        new Date().toISOString(),
        accountId,
      );
    return (await this.get(accountId))!;
  }

  async delete(accountId: string): Promise<void> {
    const account = await this.client.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!account) throw Errors.notFound('Account not found.');
    const count = (await this.client
      .prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?')
      .get(accountId)) as { n: number };
    if (count.n > 0) throw Errors.conflict('Archive this account instead; it has transactions that cannot be silently deleted.');
    await this.client.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  }
}

export class CategoryService {
  constructor(private readonly client: SqlClient) {}

  async list(includeArchived = false, onlyId?: string): Promise<Category[]> {
    const rows = (await this.client
      .prepare(
        `SELECT * FROM categories WHERE ${includeArchived ? '1 = 1' : 'archived = 0'}${onlyId ? ' AND id = ?' : ''} ORDER BY kind ASC, name ASC`,
      )
      .all(...(onlyId ? [onlyId] : []))) as Array<{
      id: string;
      name: string;
      kind: 'income' | 'expense';
      color: string;
      icon: string;
      is_system: number;
      archived: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      icon: row.icon,
      isSystem: row.is_system === 1,
      archived: row.archived === 1,
    }));
  }

  async get(categoryId: string): Promise<Category | null> {
    return (await this.list(true, categoryId))[0] ?? null;
  }

  async create(input: { name: string; kind: 'expense' | 'income'; color?: string; icon?: string }): Promise<Category> {
    if (!input.name?.trim() || input.name.trim().length > 60) throw Errors.badRequest('Category name must be 1–60 characters.');
    const id = randomToken(18);
    const now = new Date().toISOString();
    try {
      await this.client
        .prepare(
          `INSERT INTO categories (id, name, kind, color, icon, is_system, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        )
        .run(
          id,
          input.name.trim(),
          input.kind,
          input.color ?? 'oklch(0.7 0.08 220)',
          input.icon ?? 'circle',
          now,
          now,
        );
    } catch (error) {
      if (isUniqueViolation(error)) throw Errors.conflict('A category with that name already exists.');
      throw error;
    }
    return (await this.get(id))!;
  }

  async update(categoryId: string, patch: { name?: string; color?: string; icon?: string; archived?: boolean }): Promise<Category> {
    const existing = (await this.client.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)) as
      | { name: string; color: string; icon: string; archived: number }
      | undefined;
    if (!existing) throw Errors.notFound('Category not found.');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 60)) throw Errors.badRequest('Category name must be 1–60 characters.');
    try {
      await this.client
        .prepare('UPDATE categories SET name = ?, color = ?, icon = ?, archived = ?, updated_at = ? WHERE id = ?')
        .run(
          patch.name?.trim() ?? existing.name,
          patch.color ?? existing.color,
          patch.icon ?? existing.icon,
          patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
          new Date().toISOString(),
          categoryId,
        );
    } catch (error) {
      if (isUniqueViolation(error)) throw Errors.conflict('A category with that name already exists.');
      throw error;
    }
    return (await this.get(categoryId))!;
  }

  async delete(categoryId: string): Promise<void> {
    const existing = (await this.client.prepare('SELECT is_system FROM categories WHERE id = ?').get(categoryId)) as
      | { is_system: number }
      | undefined;
    if (!existing) throw Errors.notFound('Category not found.');
    if (existing.is_system === 1) throw Errors.badRequest('Built-in categories can be archived but not deleted.');
    const used = (await this.client
      .prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?')
      .get(categoryId)) as { n: number };
    const splits = (await this.client
      .prepare('SELECT COUNT(*) AS n FROM transaction_splits WHERE category_id = ?')
      .get(categoryId)) as { n: number };
    const budgets = (await this.client
      .prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?')
      .get(categoryId)) as { n: number };
    if (used.n + splits.n + budgets.n > 0) throw Errors.conflict('This category is in use. Archive it instead.');
    await this.client.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  }
}
