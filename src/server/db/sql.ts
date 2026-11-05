import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Parameters accepted by the SQL layer. The application historically used
 * SQLite's synchronous `?`-placeholder API, so this wrapper keeps the same
 * calling convention and translates placeholders for PostgreSQL. That keeps
 * the query text in the services readable and avoids a risky rewrite of every
 * statement while the storage engine changes underneath it.
 */
export type SqlParam = string | number | bigint | boolean | Buffer | Date | null | undefined;

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  get<T = Record<string, unknown>>(...params: SqlParam[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: SqlParam[]): Promise<T[]>;
  run(...params: SqlParam[]): Promise<SqlRunResult>;
}

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** The subset of operations available inside a transaction. */
export interface SqlExecutor {
  query(sql: string, params: SqlParam[]): Promise<SqlQueryResult>;
  exec(sql: string): Promise<void>;
}

export interface SqlEngine extends SqlExecutor {
  readonly kind: 'postgres' | 'pglite';
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Convert SQLite-style positional placeholders to PostgreSQL's numbered form.
 * The scanner deliberately skips quoted strings, identifiers, comments, and
 * dollar-quoted bodies so a literal question mark is never rewritten.
 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let parameter = 0;
  let state: 'normal' | 'single' | 'double' | 'line' | 'block' | 'dollar' = 'normal';
  let dollarTag = '';

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (state === 'normal') {
      if (char === "'") {
        state = 'single';
        out += char;
        index += 1;
      } else if (char === '"') {
        state = 'double';
        out += char;
        index += 1;
      } else if (char === '-' && next === '-') {
        state = 'line';
        out += '--';
        index += 2;
      } else if (char === '/' && next === '*') {
        state = 'block';
        out += '/*';
        index += 2;
      } else if (char === '$') {
        const match = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(index));
        if (match) {
          dollarTag = match[0];
          state = 'dollar';
          out += dollarTag;
          index += dollarTag.length;
        } else {
          out += char;
          index += 1;
        }
      } else if (char === '?') {
        parameter += 1;
        out += `$${parameter}`;
        index += 1;
      } else {
        out += char;
        index += 1;
      }
      continue;
    }

    if (state === 'single') {
      if (char === "'") {
        if (next === "'") {
          out += "''";
          index += 2;
        } else {
          state = 'normal';
          out += char;
          index += 1;
        }
      } else {
        out += char;
        index += 1;
      }
      continue;
    }

    if (state === 'double') {
      if (char === '"') {
        if (next === '"') {
          out += '""';
          index += 2;
        } else {
          state = 'normal';
          out += char;
          index += 1;
        }
      } else {
        out += char;
        index += 1;
      }
      continue;
    }

    if (state === 'line') {
      out += char;
      index += 1;
      if (char === '\n') state = 'normal';
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'normal';
        out += '*/';
        index += 2;
      } else {
        out += char;
        index += 1;
      }
      continue;
    }

    // Dollar-quoted string.
    if (sql.startsWith(dollarTag, index)) {
      state = 'normal';
      out += dollarTag;
      index += dollarTag.length;
    } else {
      out += char;
      index += 1;
    }
  }

  return out;
}

function normalizeParam(param: SqlParam): SqlParam {
  if (param === undefined) return null;
  if (typeof param === 'boolean') return param ? 1 : 0;
  if (param instanceof Date) return param.toISOString();
  return param;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      changed = true;
      result[key] = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value;
    } else {
      result[key] = value;
    }
  }
  return changed ? result : row;
}

/**
 * PostgreSQL-backed client with the same ergonomics as the old synchronous
 * SQLite handle. Transactions are propagated through AsyncLocalStorage so
 * existing service code can keep using `this.client` inside a transaction
 * callback without threading a second handle through every method.
 */
export class SqlClient implements SqlExecutor {
  private readonly transactions = new AsyncLocalStorage<SqlExecutor>();

  constructor(
    readonly engine: SqlEngine,
    readonly kind: SqlEngine['kind'],
  ) {}

  private current(): SqlExecutor {
    return this.transactions.getStore() ?? this.engine;
  }

  async query(sql: string, params: SqlParam[] = []): Promise<SqlQueryResult> {
    const result = await this.current().query(
      toPgPlaceholders(sql),
      params.map(normalizeParam),
    );
    return {
      rows: result.rows.map(normalizeRow),
      rowCount: result.rowCount,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.current().exec(sql);
  }

  prepare(sql: string): SqlStatement {
    const text = toPgPlaceholders(sql);
    return {
      get: async <T>(...params: SqlParam[]): Promise<T | undefined> => {
        const result = await this.current().query(text, params.map(normalizeParam));
        const row = result.rows[0];
        return row ? (normalizeRow(row) as T) : undefined;
      },
      all: async <T>(...params: SqlParam[]): Promise<T[]> => {
        const result = await this.current().query(text, params.map(normalizeParam));
        return result.rows.map((row) => normalizeRow(row) as T);
      },
      run: async (...params: SqlParam[]): Promise<SqlRunResult> => {
        const result = await this.current().query(text, params.map(normalizeParam));
        return { changes: result.rowCount, lastInsertRowid: 0 };
      },
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // A nested call joins the transaction that is already active. PostgreSQL
    // does not need a savepoint for the app's current usage, and joining keeps
    // the audit chain lock and ownership checks in one atomic unit.
    if (this.transactions.getStore()) return fn();
    return this.engine.transaction((tx) => this.transactions.run(tx, fn));
  }

  async close(): Promise<void> {
    await this.engine.close();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('duplicate key value') || message.includes('UNIQUE constraint failed');
}

export function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23503') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('violates foreign key constraint') || message.includes('FOREIGN KEY constraint failed');
}
