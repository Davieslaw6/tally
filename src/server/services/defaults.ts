import type { SqlClient } from '../db/sql';
import { randomToken } from '../security/crypto';

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  kind: 'expense' | 'income';
  color: string;
  icon: string;
}> = [
  { name: 'Groceries', kind: 'expense', color: 'oklch(0.74 0.11 150)', icon: 'basket' },
  { name: 'Dining', kind: 'expense', color: 'oklch(0.74 0.13 50)', icon: 'utensils' },
  { name: 'Housing', kind: 'expense', color: 'oklch(0.69 0.09 255)', icon: 'home' },
  { name: 'Utilities', kind: 'expense', color: 'oklch(0.72 0.11 220)', icon: 'zap' },
  { name: 'Transport', kind: 'expense', color: 'oklch(0.71 0.10 195)', icon: 'car' },
  { name: 'Shopping', kind: 'expense', color: 'oklch(0.72 0.12 330)', icon: 'bag' },
  { name: 'Health', kind: 'expense', color: 'oklch(0.72 0.12 25)', icon: 'heart' },
  { name: 'Entertainment', kind: 'expense', color: 'oklch(0.70 0.13 300)', icon: 'film' },
  { name: 'Travel', kind: 'expense', color: 'oklch(0.72 0.10 175)', icon: 'plane' },
  { name: 'Subscriptions', kind: 'expense', color: 'oklch(0.71 0.10 280)', icon: 'repeat' },
  { name: 'Fees & Interest', kind: 'expense', color: 'oklch(0.68 0.10 40)', icon: 'receipt' },
  { name: 'Income', kind: 'income', color: 'oklch(0.75 0.13 155)', icon: 'arrow-down' },
  { name: 'Other', kind: 'expense', color: 'oklch(0.65 0.02 250)', icon: 'circle' },
];

export async function seedCategories(client: SqlClient, nowIso = new Date().toISOString()): Promise<void> {
  const insert = client.prepare(
    `INSERT INTO categories (id, name, kind, color, icon, is_system, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  await client.transaction(async () => {
    for (const category of DEFAULT_CATEGORIES) {
      await insert.run(
        randomToken(18),
        category.name,
        category.kind,
        category.color,
        category.icon,
        nowIso,
        nowIso,
      );
    }
  });
}
