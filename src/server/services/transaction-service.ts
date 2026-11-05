import type { AppConfig } from '../config';
import type { Logger } from '../logger';
import type { SqlClient, SqlParam } from '../db/sql';
import { randomToken } from '../security/crypto';
import { Errors } from '../errors';
import { isValidISODate } from '../../shared/dates';
import type { Paged, Transaction } from '../../shared/types';

export interface TransactionQuery {
  limit: number;
  offset: number;
  search?: string;
  from?: string;
  to?: string;
  accountIds?: string[];
  categoryIds?: string[];
  type?: 'all' | 'inflow' | 'outflow';
  tag?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
}

export interface TransactionWrite {
  accountId: string;
  categoryId?: string | null;
  amountCents: number;
  date: string;
  description: string;
  merchant?: string | null;
  notes?: string | null;
  tags?: string[];
  excludedFromReports?: boolean;
  splits?: Array<{ categoryId: string; amountCents: number; note?: string | null }>;
}

interface TxRow {
  id: string;
  account_id: string;
  account_name: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  amount_cents: number;
  txn_date: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  tags: string;
  is_transfer: number;
  transfer_group_id: string | null;
  is_split: number;
  excluded_from_reports: number;
  created_at: string;
  updated_at: string;
}

function serializeTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().slice(0, 32))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function toDto(row: TxRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    amountCents: row.amount_cents,
    date: row.txn_date,
    description: row.description,
    merchant: row.merchant,
    notes: row.notes,
    tags: serializeTags(row.tags),
    isTransfer: row.is_transfer === 1,
    transferGroupId: row.transfer_group_id,
    isSplit: row.is_split === 1,
    excludedFromReports: row.excluded_from_reports === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TransactionService {
  constructor(
    private readonly config: AppConfig,
    private readonly client: SqlClient,
    private readonly logger: Logger,
  ) {}

  private buildWhere(query: TransactionQuery): { sql: string; params: SqlParam[] } {
    const clauses: string[] = [];
    const params: SqlParam[] = [];
    if (query.from) {
      if (!isValidISODate(query.from)) throw Errors.badRequest('Invalid from date.');
      clauses.push('t.txn_date >= ?');
      params.push(query.from);
    }
    if (query.to) {
      if (!isValidISODate(query.to)) throw Errors.badRequest('Invalid to date.');
      clauses.push('t.txn_date <= ?');
      params.push(query.to);
    }
    if (query.accountIds?.length) {
      if (query.accountIds.length > 50) throw Errors.badRequest('Too many account filters.');
      clauses.push(`t.account_id IN (${query.accountIds.map(() => '?').join(',')})`);
      params.push(...query.accountIds);
    }
    if (query.categoryIds?.length) {
      if (query.categoryIds.length > 50) throw Errors.badRequest('Too many category filters.');
      const placeholders = query.categoryIds.map(() => '?').join(',');
      clauses.push(
        `(t.category_id IN (${placeholders}) OR EXISTS (
          SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.category_id IN (${placeholders})
        ))`,
      );
      params.push(...query.categoryIds, ...query.categoryIds);
    }
    if (query.type === 'inflow') clauses.push('t.amount_cents > 0');
    if (query.type === 'outflow') clauses.push('t.amount_cents < 0');
    if (query.tag) {
      clauses.push('EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.tags::jsonb) AS tag(value) WHERE tag.value = ?)');
      params.push(query.tag.slice(0, 32));
    }
    if (query.search?.trim()) {
      // Escape LIKE wildcards so searching for "50%" or "a_b" matches literally.
      const escaped = query.search.trim().slice(0, 200).toLocaleLowerCase().replace(/[\\%_]/g, '\\$&');
      const term = `%${escaped}%`;
      clauses.push(
        `(LOWER(t.description) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(t.merchant, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(t.notes, '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(term, term, term);
    }
    return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
  }

  async list(query: TransactionQuery): Promise<Paged<Transaction>> {
    const where = this.buildWhere(query);
    const sortMap: Record<string, string> = {
      date_desc: 't.txn_date DESC, t.created_at DESC, t.id DESC',
      date_asc: 't.txn_date ASC, t.created_at ASC, t.id ASC',
      amount_desc: 'ABS(t.amount_cents) DESC, t.txn_date DESC',
      amount_asc: 'ABS(t.amount_cents) ASC, t.txn_date DESC',
    };
    const order = sortMap[query.sort ?? 'date_desc'] ?? sortMap.date_desc;
    const totalRow = (await this.client
      .prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE ${where.sql}`)
      .get(...where.params)) as { n: number };
    const rows = (await this.client
      .prepare(
        `SELECT t.*, a.name AS account_name, c.name AS category_name, c.color AS category_color
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${where.sql}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, query.limit, query.offset)) as TxRow[];
    return {
      items: rows.map(toDto),
      total: totalRow.n,
      offset: query.offset,
      limit: query.limit,
      hasMore: query.offset + rows.length < totalRow.n,
    };
  }

  async get(transactionId: string): Promise<Transaction | null> {
    const row = (await this.client
      .prepare(
        `SELECT t.*, a.name AS account_name, c.name AS category_name, c.color AS category_color
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.id = ?`,
      )
      .get(transactionId)) as TxRow | undefined;
    if (!row) return null;
    const transaction = toDto(row);
    const splits = (await this.client
      .prepare(
        `SELECT s.id, s.category_id, s.amount_cents, s.note, c.name AS category_name
         FROM transaction_splits s
         LEFT JOIN categories c ON c.id = s.category_id
         WHERE s.transaction_id = ?
         ORDER BY s.created_at ASC`,
      )
      .all(transactionId)) as Array<{
      id: string;
      category_id: string;
      amount_cents: number;
      note: string | null;
      category_name: string | null;
    }>;
    transaction.splits = splits.map((split) => ({
      id: split.id,
      categoryId: split.category_id,
      categoryName: split.category_name,
      amountCents: split.amount_cents,
      note: split.note,
    }));
    return transaction;
  }

  private async assertAccount(accountId: string): Promise<void> {
    const row = await this.client.prepare('SELECT id FROM accounts WHERE id = ? AND archived = 0').get(accountId);
    if (!row) throw Errors.badRequest('Choose one of your active accounts.');
  }

  private async assertCategory(categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const row = await this.client.prepare('SELECT id FROM categories WHERE id = ? AND archived = 0').get(categoryId);
    if (!row) throw Errors.badRequest('Choose one of your categories.');
  }

  private async validateSplits(
    splits: TransactionWrite['splits'],
    amountCents: number,
  ): Promise<Array<{ categoryId: string; amountCents: number; note: string | null }>> {
    if (!splits) return [];
    if (splits.length < 2) throw Errors.badRequest('A split transaction needs at least two parts.');
    if (splits.length > 20) throw Errors.badRequest('A transaction can have at most 20 splits.');
    let sum = 0;
    for (const split of splits) {
      if (!Number.isSafeInteger(split.amountCents) || split.amountCents === 0) {
        throw Errors.badRequest('Split amounts must be non-zero integer cents.');
      }
      if (Math.sign(split.amountCents) !== Math.sign(amountCents)) {
        throw Errors.badRequest('Split amounts must share the transaction sign.');
      }
      await this.assertCategory(split.categoryId);
      sum += split.amountCents;
    }
    if (sum !== amountCents) throw Errors.badRequest('Split amounts must add up to the transaction total.');
    return splits.map((split) => ({
      categoryId: split.categoryId,
      amountCents: split.amountCents,
      note: split.note?.trim().slice(0, 1000) || null,
    }));
  }

  private async assertWithinLimit(): Promise<void> {
    const row = (await this.client.prepare('SELECT COUNT(*) AS n FROM transactions').get()) as { n: number };
    if (row.n >= this.config.maxTransactions) {
      throw Errors.badRequest('This ledger has reached its transaction limit.');
    }
  }

  async create(input: TransactionWrite): Promise<Transaction> {
    if (!isValidISODate(input.date)) throw Errors.badRequest('Transaction date is invalid.');
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) {
      throw Errors.badRequest('Amount must be non-zero integer cents.');
    }
    if (input.amountCents > 1_000_000_000_000 || input.amountCents < -1_000_000_000_000) {
      throw Errors.badRequest('Amount is too large.');
    }
    if (!input.description?.trim()) throw Errors.badRequest('Description is required.');
    if (input.description.length > 500) throw Errors.badRequest('Description must be 500 characters or fewer.');
    await this.assertWithinLimit();
    await this.assertAccount(input.accountId);
    await this.assertCategory(input.categoryId);
    const splits = await this.validateSplits(input.splits, input.amountCents);
    const tags = normalizeTags(input.tags);
    const id = randomToken(18);
    const now = new Date().toISOString();
    const isSplit = splits.length > 0 ? 1 : 0;
    const description = input.description.trim();
    const merchant = input.merchant?.trim().slice(0, 200) || null;
    const notes = input.notes?.trim().slice(0, 5000) || null;

    await this.client.transaction(async () => {
      await this.client
        .prepare(
          `INSERT INTO transactions
            (id, account_id, category_id, amount_cents, txn_date, description, merchant, notes, tags,
             is_transfer, is_split, excluded_from_reports, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.accountId,
          isSplit ? null : input.categoryId ?? null,
          input.amountCents,
          input.date,
          description,
          merchant,
          notes,
          JSON.stringify(tags),
          isSplit,
          input.excludedFromReports ? 1 : 0,
          now,
          now,
        );
      if (splits.length) {
        const insertSplit = this.client.prepare(
          `INSERT INTO transaction_splits (id, transaction_id, category_id, amount_cents, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const split of splits) {
          await insertSplit.run(randomToken(18), id, split.categoryId, split.amountCents, split.note, now);
        }
      }
    });
    return (await this.get(id))!;
  }

  async update(transactionId: string, patch: Partial<TransactionWrite>): Promise<Transaction> {
    const existing = (await this.client.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId)) as
      | TxRow
      | undefined;
    if (!existing) throw Errors.notFound('Transaction not found.');
    if (existing.is_transfer === 1) throw Errors.badRequest('Edit transfers from the transfer view.');

    const amountCents = patch.amountCents ?? existing.amount_cents;
    const txnDate = patch.date ?? existing.txn_date;
    const description = patch.description !== undefined ? patch.description : existing.description;
    const merchant = patch.merchant !== undefined ? patch.merchant : existing.merchant;
    const notes = patch.notes !== undefined ? patch.notes : existing.notes;

    if (!isValidISODate(txnDate)) throw Errors.badRequest('Transaction date is invalid.');
    if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw Errors.badRequest('Amount must be non-zero integer cents.');
    if (!description?.trim()) throw Errors.badRequest('Description is required.');
    if (description.length > 500) throw Errors.badRequest('Description must be 500 characters or fewer.');
    // Only re-validate values that actually change, so transactions on an
    // archived account or category can still be edited.
    if (patch.accountId && patch.accountId !== existing.account_id) await this.assertAccount(patch.accountId);
    if (patch.categoryId !== undefined && patch.categoryId !== existing.category_id) {
      await this.assertCategory(patch.categoryId);
    }

    const splits = patch.splits ? await this.validateSplits(patch.splits, amountCents) : [];
    // A split transaction edited with a category and no splits means the owner
    // switched it back to a single category.
    const unsplit = existing.is_split === 1 && !patch.splits && patch.categoryId !== undefined;
    if (existing.is_split === 1 && !patch.splits && !unsplit) {
      const aggregate = (await this.client
        .prepare('SELECT SUM(amount_cents) AS total FROM transaction_splits WHERE transaction_id = ?')
        .get(transactionId)) as { total: number | null };
      if ((aggregate.total ?? 0) !== amountCents) {
        throw Errors.badRequest('Update the split parts when changing a split transaction total.');
      }
    }

    const tags = patch.tags !== undefined ? normalizeTags(patch.tags) : serializeTags(existing.tags);
    const newIsSplit = patch.splits ? 1 : unsplit ? 0 : existing.is_split;
    const now = new Date().toISOString();

    await this.client.transaction(async () => {
      await this.client
        .prepare(
          `UPDATE transactions SET
             account_id = ?, category_id = ?, amount_cents = ?, txn_date = ?, description = ?, merchant = ?,
             notes = ?, tags = ?, is_split = ?, excluded_from_reports = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          patch.accountId ?? existing.account_id,
          newIsSplit ? null : patch.categoryId !== undefined ? patch.categoryId : existing.category_id,
          amountCents,
          txnDate,
          description.trim(),
          merchant?.trim().slice(0, 200) || null,
          notes?.trim().slice(0, 5000) || null,
          JSON.stringify(tags),
          newIsSplit,
          patch.excludedFromReports !== undefined ? (patch.excludedFromReports ? 1 : 0) : existing.excluded_from_reports,
          now,
          transactionId,
        );
      if (unsplit) {
        await this.client.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(transactionId);
      }
      if (patch.splits) {
        await this.client.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(transactionId);
        const insert = this.client.prepare(
          `INSERT INTO transaction_splits (id, transaction_id, category_id, amount_cents, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const split of splits) {
          await insert.run(randomToken(18), transactionId, split.categoryId, split.amountCents, split.note, now);
        }
      }
    });
    return (await this.get(transactionId))!;
  }

  async delete(transactionId: string): Promise<{ deletedIds: string[] }> {
    const row = (await this.client
      .prepare('SELECT id, transfer_group_id, is_transfer FROM transactions WHERE id = ?')
      .get(transactionId)) as { id: string; transfer_group_id: string | null; is_transfer: number } | undefined;
    if (!row) throw Errors.notFound('Transaction not found.');
    const ids =
      row.is_transfer === 1 && row.transfer_group_id
        ? (
            (await this.client
              .prepare('SELECT id FROM transactions WHERE transfer_group_id = ?')
              .all(row.transfer_group_id)) as Array<{ id: string }>
          ).map((item) => item.id)
        : [transactionId];
    const placeholders = ids.map(() => '?').join(',');
    await this.client.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
    return { deletedIds: ids };
  }

  async createTransfer(input: {
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
    date: string;
    description?: string;
    notes?: string | null;
  }): Promise<Transaction[]> {
    if (input.fromAccountId === input.toAccountId) throw Errors.badRequest('Choose two different accounts.');
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw Errors.badRequest('Transfer amount must be positive integer cents.');
    }
    if (input.amountCents > 1_000_000_000_000) throw Errors.badRequest('Transfer amount is too large.');
    if (!isValidISODate(input.date)) throw Errors.badRequest('Transfer date is invalid.');
    await this.assertAccount(input.fromAccountId);
    await this.assertAccount(input.toAccountId);

    const groupId = randomToken(18);
    const description = input.description?.trim().slice(0, 500) || 'Transfer between accounts';
    const notes = input.notes?.trim().slice(0, 5000) || null;
    const now = new Date().toISOString();
    const ids = [randomToken(18), randomToken(18)] as const;
    const insert = this.client.prepare(
      `INSERT INTO transactions
        (id, account_id, category_id, amount_cents, txn_date, description, merchant, notes, tags, is_transfer,
         transfer_group_id, is_split, excluded_from_reports, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, '[]', 1, ?, 0, 1, ?, ?)`,
    );
    await this.client.transaction(async () => {
      await insert.run(ids[0], input.fromAccountId, -input.amountCents, input.date, description, notes, groupId, now, now);
      await insert.run(ids[1], input.toAccountId, input.amountCents, input.date, description, notes, groupId, now, now);
    });
    return Promise.all(ids.map(async (id) => (await this.get(id))!));
  }

  async bulk(
    action: 'delete' | 'categorize' | 'exclude' | 'include',
    ids: string[],
    categoryId?: string | null,
  ): Promise<{ affected: number }> {
    if (!ids.length || ids.length > 500) throw Errors.badRequest('Select between 1 and 500 transactions.');
    const placeholders = ids.map(() => '?').join(',');
    const found = (await this.client
      .prepare(`SELECT id, transfer_group_id, is_transfer FROM transactions WHERE id IN (${placeholders})`)
      .all(...ids)) as Array<{ id: string; transfer_group_id: string | null; is_transfer: number }>;
    if (found.length !== ids.length) throw Errors.notFound('One or more transactions were not found.');

    return this.client.transaction(() => this.runBulk(action, ids, categoryId, found, placeholders));
  }

  private async runBulk(
    action: 'delete' | 'categorize' | 'exclude' | 'include',
    ids: string[],
    categoryId: string | null | undefined,
    found: Array<{ id: string; transfer_group_id: string | null; is_transfer: number }>,
    placeholders: string,
  ): Promise<{ affected: number }> {
    if (action === 'delete') {
      const allIds = new Set(found.map((row) => row.id));
      for (const row of found) {
        if (row.is_transfer === 1 && row.transfer_group_id) {
          const group = (await this.client
            .prepare('SELECT id FROM transactions WHERE transfer_group_id = ?')
            .all(row.transfer_group_id)) as Array<{ id: string }>;
          for (const item of group) allIds.add(item.id);
        }
      }
      const finalIds = [...allIds];
      const ph = finalIds.map(() => '?').join(',');
      await this.client.prepare(`DELETE FROM transactions WHERE id IN (${ph})`).run(...finalIds);
      return { affected: finalIds.length };
    }

    if (action === 'categorize') {
      if (!categoryId) throw Errors.badRequest('Choose a category.');
      await this.assertCategory(categoryId);
      const result = await this.client
        .prepare(
          `UPDATE transactions SET category_id = ?, is_split = 0, updated_at = ?
           WHERE id IN (${placeholders}) AND is_transfer = 0`,
        )
        .run(categoryId, new Date().toISOString(), ...ids);
      await this.client.prepare(`DELETE FROM transaction_splits WHERE transaction_id IN (${placeholders})`).run(...ids);
      return { affected: result.changes };
    }

    if (action === 'exclude' || action === 'include') {
      const result = await this.client
        .prepare(`UPDATE transactions SET excluded_from_reports = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(action === 'exclude' ? 1 : 0, new Date().toISOString(), ...ids);
      return { affected: result.changes };
    }
    throw Errors.badRequest('Unknown bulk action.');
  }

  async count(): Promise<number> {
    const row = (await this.client.prepare('SELECT COUNT(*) AS n FROM transactions').get()) as { n: number };
    return row.n;
  }
}
