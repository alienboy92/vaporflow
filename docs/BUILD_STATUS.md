# VaporFlow — Build Status

Updated 16 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Current decision — 16 November 2026

**READY FOR PHASE 8B (Cloud integration and Auth preparation). Phase 8A sync engine is complete and independently reviewed; all ten review findings repaired.**

- Phase 8A Sync Engine (`packages/core/src/sync/`):
  - Minimal transport interface matching `sync_push` and `sync_pull` RPCs (`SyncTransport`, batch-atomic RPC-faithful `SQLiteSyncServer`).
  - Push: up to 200 dirty rows in foreign-key dependency order; retry-safe insert-only ledgers and strict `updated_at` last-write-wins for mutable rows; dirty cleared only for the exact acknowledged version via one atomic conditional batch (`WHERE dirty = 1 AND updated_at = snapshot`) so mid-flight edits remain pending; transport rejections throw like the real RPC, surface in `problems` + `lastError`, and trigger exponential-backoff retries.
  - Pull: ordered by `(server_updated_at, id)`, up to 500 per page; 5-second overlap at cycle start; page and cursor applied in one atomic `DbAdapter.batch(...)` transaction; validation-rejected rows still advance the cursor (kept in `problems`) so a bad page cannot wedge the pull; preserves dirty newer local mutable rows and inserts ledger rows idempotently.
  - PG↔local wire conversion (`sync/convert.ts`): booleans true/false ↔ 0/1, timestamps normalized to exactly-3ms UTC (sub-ms truncated), `dirty` never crosses the wire — verified with production-shaped PGlite-style payloads.
  - Triggers & State: one sync at a time, exponential backoff (cancelled by `stop()`), app-start, network return, 30-second interval, 2-second after-sale, and manual triggers. Exposes status (`synced`, `pending`, `offline`, `error`), pending counts, last success, `lastError`, and row-specific problems.
  - Tests: 19 sync tests — two-device offline sales convergence, summed stock, identical totals, strict-LWW timestamp ties, batch-atomic duplicate-barcode rejection, retry/backoff, in-flight edit preservation, failed-page rollback with unchanged cursor, 5s overlap re-pull, >1,200-row offline catch-up, queued overlapping runs, soft-delete propagation — plus 6 wire-conversion unit tests and the pre-existing PGlite coverage of the real RPCs.
- Final root checks: `pnpm lint` PASS, `pnpm typecheck` PASS, `pnpm test` PASS (**134 tests pass**, 2 skipped opt-in benchmarks), `pnpm --filter @vaporflow/app build` PASS.
- Live Supabase deployment, authenticated two-device checks, and cloud enrollment remain NOT RUN (Phase 8B scope); details in the [Phase 8A review](PHASE8A_REVIEW.md).
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
| 8A — Sync engine   | READY (local simulation)       | Transport boundary (`SyncTransport`, RPC-faithful `SQLiteSyncServer`), push/pull engine (`SyncEngine`), 5s overlap cursor pagination, dependency-ordered push, strict-LWW mutable / idempotent ledger handling, PG↔local wire conversion (booleans, 3ms timestamps, no `dirty` over the wire), batch-atomic rejection with surfaced `lastError`/problems, conditional atomic dirty-clears; 15 sync tests (two-device convergence, backoff retry, in-flight edits, page rollback, overlap re-pull, >500-row catch-up, tombstones, timestamp ties) + 6 conversion unit tests + PGlite RPC coverage; [Phase 8A review](PHASE8A_REVIEW.md). Live Supabase device checks deferred to 8B. |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

Never mark an unrun hardware check as passed.
