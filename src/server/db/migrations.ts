export interface Migration {
  version: string;
  sql: string;
}

/**
 * The whole schema lives in one migration because TALLY is a single-owner,
 * single-database app. Keeping it in TypeScript means the serverless bundle
 * never has to read SQL files from disk at runtime.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: '0001_core',
    sql: `
      CREATE TABLE IF NOT EXISTS owner (
        id TEXT PRIMARY KEY CHECK (id = 'owner'),
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        display_name TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        locale TEXT NOT NULL DEFAULT 'en-US',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        session_epoch INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY CHECK (id = 'owner'),
        theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'contrast')),
        density TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
        nav_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (nav_collapsed IN (0, 1)),
        chart_view TEXT NOT NULL DEFAULT 'bar' CHECK (chart_view IN ('bar', 'area', 'line')),
        chart_range TEXT NOT NULL DEFAULT '6M',
        onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
        color TEXT NOT NULL DEFAULT 'oklch(0.7 0.08 220)',
        icon TEXT NOT NULL DEFAULT 'circle',
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique ON categories (lower(name));

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit', 'cash', 'investment')),
        institution TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        opening_balance_cents BIGINT NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT 'oklch(0.7 0.08 220)',
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts (archived);

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
        txn_date TEXT NOT NULL CHECK (char_length(txn_date) = 10),
        description TEXT NOT NULL,
        merchant TEXT,
        notes TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        is_transfer INTEGER NOT NULL DEFAULT 0 CHECK (is_transfer IN (0, 1)),
        transfer_group_id TEXT,
        is_split INTEGER NOT NULL DEFAULT 0 CHECK (is_split IN (0, 1)),
        excluded_from_reports INTEGER NOT NULL DEFAULT 0 CHECK (excluded_from_reports IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (txn_date DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions (account_id, txn_date DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_category_date ON transactions (category_id, txn_date DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_transfer_group ON transactions (transfer_group_id);

      CREATE TABLE IF NOT EXISTS transaction_splits (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_splits_tx ON transaction_splits (transaction_id);
      CREATE INDEX IF NOT EXISTS idx_splits_category ON transaction_splits (category_id);

      CREATE VIEW transaction_allocations AS
        SELECT
          t.id AS transaction_id,
          t.account_id,
          t.txn_date,
          t.amount_cents AS allocation_amount_cents,
          t.category_id,
          t.is_transfer,
          t.excluded_from_reports
        FROM transactions t
        WHERE t.is_split = 0
        UNION ALL
        SELECT
          t.id,
          t.account_id,
          t.txn_date,
          s.amount_cents,
          s.category_id,
          t.is_transfer,
          t.excluded_from_reports
        FROM transactions t
        JOIN transaction_splits s ON s.transaction_id = t.id
        WHERE t.is_split = 1;

      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        month TEXT NOT NULL CHECK (char_length(month) = 7),
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        alert_threshold INTEGER NOT NULL DEFAULT 80 CHECK (alert_threshold BETWEEN 1 AND 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets (month);

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_cents BIGINT NOT NULL CHECK (target_cents > 0),
        target_date TEXT,
        color TEXT NOT NULL DEFAULT 'oklch(0.72 0.13 170)',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goal_contributions (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
        note TEXT,
        contributed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goal_contrib_goal ON goal_contributions (goal_id, contributed_at DESC);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `,
  },
];
