# Phase 1 correction handoff

Implemented and verified locally on 15 November 2026.

## Changes

- Exact integer parsing, discount and refund arithmetic with safe-integer bounds and BigInt intermediates.
- Discount rounding follows SPEC 8.4 literally: the last line receives the remainder. The owner explicitly chose to allow a negative last line on rounding edge cases. SPEC.md was not changed.
- Sale/return input and stored entity validation; UUID v7 generation uses Web Crypto, not Node-only crypto.
- Return limits are rechecked inside the same batch as all writes. Duplicate selections of the same sale item are rejected. Concurrent local calls cannot over-return. Sales guard against a concurrent cost edit before committing a snapshot.
- Ledger business data is immutable in SQLite; sync can update only dirty/server_updated_at metadata. PostgreSQL ledgers reject updates/deletes and parent deletion cannot cascade through history.
- Promise-based DbAdapter exported from core; the better-sqlite3 test adapter is isolated in src/testing and migrations are transactional.
- Local calendar date ranges, including Asia/Karachi boundaries. Daily series contains net revenue and net profit, including returns/expenses on their own dates and zero-filled days. Top-item tables show sold quantity and sale margin before returns; cash/online cards show sale payment totals, matching the original seeded expectations.
- Cloud membership creation is serialized and reserved atomically. The initial real shop push replaces placeholder metadata. Tables are read-only through the ordinary authenticated API; writes use checked RPCs. Cross-shop conflicts/references are rejected; stock views use invoker RLS. Pull supports an initial null cursor and bounded, ordered pages.

## Verify

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

The suite runs real SQLite through better-sqlite3 and PostgreSQL in memory through PGlite. No Docker daemon, account credentials, network connection, or hosted deployment is needed to run tests after installation. The PostgreSQL suite supplies minimal auth.users/auth.uid fixtures and exercises authenticated/anon database roles.

The seeded P&L remains: revenue 6000, COGS 2400, gross profit 3600, expenses 500, net profit 3100, 2 sales, average sale 3500, cash sales 5000, online sales 2000.

## Scope and remaining verification

No UI, Electron/Capacitor implementation, sync client, or deployment was added. Those remain later phases. Phase 2 should implement the asynchronous adapter contract and apply both SQLite migration files.

The PostgreSQL tests validate SQL and RLS, not Supabase HTTP/Auth integration. PGlite uses one connection, so multi-connection claim contention is protected in SQL by advisory locks and uniqueness but is not stress-tested here. Hosted integration belongs to Phase 10 before deployment approval.

The initial migrations are still pre-deployment files. Do not apply them over an already-deployed database; use an upgrade migration in that situation. Local return protection does not coordinate two devices while both are offline; that cross-device case belongs to the sync phase.

Unrelated existing desktop build artifacts were left untouched.
