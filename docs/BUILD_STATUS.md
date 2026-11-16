# VaporFlow — Build Status

Updated 16 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Current decision — 16 November 2026

**READY FOR PHASE 8B (Cloud integration and Auth preparation). Phase 8A sync engine and simulated two-device tests are complete and verified.**

- Phase 8A Sync Engine (`packages/core/src/sync/`):
  - Minimal transport interface matching `sync_push` and `sync_pull` RPCs (`SyncTransport`, `SQLiteSyncServer`).
  - Push: up to 200 dirty rows in foreign-key dependency order; retry-safe insert-only ledgers and `updated_at` last-write-wins for mutable rows; dirty cleared only for exact acknowledged versions while mid-flight edits remain pending; rejected rows surface as sync problems without disappearing or blocking valid sync data.
  - Pull: ordered by `(server_updated_at, id)`, up to 500 per page; 5-second overlap at cycle start; timestamp precision and cursor ties preserved; page and cursor applied in one atomic `DbAdapter.batch(...)` transaction; preserves dirty newer local mutable rows and inserts ledger rows idempotently.
  - Explicit Zod conversion of server/local booleans, nulls, UUIDs, and timestamps.
  - Triggers & State: one sync at a time, exponential backoff, app-start, network return, 30-second interval, 2-second after-sale, and manual triggers. Exposes status (`synced`, `pending`, `offline`, `error`), pending counts, last success, and row-specific problems.
  - Tests: 4 comprehensive sync tests covering two-device offline sales convergence, summed stock, identical totals, mutable conflicts, soft deletes, duplicate barcode conflict resolution, and retry/interruption behavior (`packages/core/src/sync.test.ts`).
- Final root checks: `pnpm lint` PASS, `pnpm typecheck` PASS, `pnpm test` PASS (**119 tests pass**, 2 skipped).
- Next action: prepare Phase 8B (Auth and Supabase cloud enrollment).

## Completed baseline (historical phase records)

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | READY FOR HARDWARE CHECK       | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |
| 4 — Products/stock | READY FOR HARDWARE CHECK       | Catalog editor, EAN-13 barcode generator, opening stock guard, soft-deletes, inventory filters, stock in/adjustments, and 66 tests. |
| 5 — Checkout/output    | READY FOR HARDWARE CHECK       | Review repairs: unique receipt numbers, 80mm print via hidden iframe, A4 3×8 label sheets with scannable EAN-13 SVG barcodes, receipt PDF share, percent/amount discounts, scan-not-found create offer, double-submit guard; 92 tests; [Phase 5 review](PHASE5_REVIEW.md). |
| 6 — History/reports| READY FOR HARDWARE CHECK       | Sales history list newest first, receipt search, date filter, per-day totals, detail/reprint receipt modal; return lines/quantities bounded by remaining sold quantity, restock/no-restock, cash/online refund, return receipt with core atomic batch & limit guard; expense list/add/edit/soft-delete with validated date, amount, category, note; P&L report cards, top-10 tables (qty and profit), daily series Recharts trend chart with presets (Today, Yesterday, Last 7 days, This month, Last month) and custom dates; review repairs: repository-backed (zod-validated) return reads instead of raw SQL in the UI, in-modal return errors, stock-badge refresh after restocking returns, current-device attribution and double-submit ref guard on expenses, honest 50-sale smoke benchmark plus opt-in `VAPORFLOW_BENCH=1` 1,000-sale benchmark (NOT RUN), all nine P&L fields and full return/no-restock/stock-ledger coverage asserted, unused `react-day-picker` removed, dead `PlaceholderScreens.tsx` deleted; 96 tests (17 files) + 1 skipped opt-in benchmark; [Phase 6 review](PHASE6_REVIEW.md). |
| 7 — Import/recovery| READY FOR HARDWARE CHECK       | CSV import with Papaparse & Zod, template generation, preview & error detection, duplicate barcode checks, chunked batches (200 rows), skip/update price strategies, and opening stock idempotence; settings backup export (`.vfbackup`) and validation/restore with transaction safety and counter recovery; 105 automated tests; [Phase 7 review](PHASE7_REVIEW.md). |
| 8A — Sync engine   | READY                          | Transport boundary (`SyncTransport`, `SQLiteSyncServer`), push/pull sync engine (`SyncEngine`), 5s overlap cursor pagination, dependency-ordered push, last-write-wins mutable / idempotent ledger handling, explicit Zod validation, problem tracking, and 4 two-device convergence/conflict tests (`packages/core/src/sync.test.ts`). |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

Never mark an unrun hardware check as passed.
