# Changes in this revision

Scope, features and UI are unchanged. Fixes and trims only.

## Bug fixes
- **Split transactions could not be turned back into a single-category transaction.** The edit dialog reported success but nothing changed. Editing a split transaction with a category and no splits now removes the splits.
- **PIN lockout could be bypassed by parallel guesses.** The failed-attempt counter is now incremented atomically in SQL.
- **Simultaneous first-time setup returned a 500.** It now returns the normal 409 "already has a PIN".
- **Transactions on an archived account or category could not be edited.** Accounts and categories are only re-validated when they actually change.
- **Net-worth trend mixed in archived accounts' transactions** while excluding their opening balances. Both now use the same set of accounts.
- **Searching for text containing `%` or `_`** matched unrelated rows. LIKE wildcards are now escaped.
- **A single malformed `tags` value broke the whole CSV export.** It is now skipped safely.
- **Bulk delete/categorize/exclude/include now run in one database transaction**, so a mid-way failure can no longer leave half-applied changes.

## Lighter and faster
- Cold starts skip the migration lock transaction when the schema is already up to date (fewer Neon round trips).
- Account and category lookups by id query one row instead of loading and filtering all rows.
- `vercel.json`: PGlite (local-dev-only) is excluded from the serverless function bundle, and the fixed memory override was removed.

## Not changed on purpose
- Single-owner PIN design, API shape, database schema and UI.
