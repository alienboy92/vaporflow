# VaporFlow — Build Status

Updated 16 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | READY FOR HARDWARE CHECK       | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |
| 4 — Products/stock | READY FOR HARDWARE CHECK       | Catalog editor, EAN-13 barcode generator, opening stock guard, soft-deletes, inventory filters, stock in/adjustments, and 66 tests. |
| 5 — Checkout/output    | READY FOR HARDWARE CHECK       | Review repairs: unique receipt numbers, 80mm print via hidden iframe, A4 3×8 label sheets with scannable EAN-13 SVG barcodes, receipt PDF share, percent/amount discounts, scan-not-found create offer, double-submit guard; 92 tests; [Phase 5 review](PHASE5_REVIEW.md). |
| 6 — History/reports| READY FOR HARDWARE CHECK       | Sales history list newest first, receipt search, date filter, per-day totals, detail/reprint receipt modal; return lines/quantities bounded by remaining sold quantity, restock/no-restock, cash/online refund, return receipt with core atomic batch & limit guard; expense list/add/edit/soft-delete with validated date, amount, category, note; P&L report cards, top-10 tables (qty and profit), daily series Recharts trend chart with presets (Today, Yesterday, Last 7 days, This month, Last month) and custom dates; review repairs: repository-backed (zod-validated) return reads instead of raw SQL in the UI, in-modal return errors, stock-badge refresh after restocking returns, current-device attribution and double-submit ref guard on expenses, honest 50-sale smoke benchmark plus opt-in `VAPORFLOW_BENCH=1` 1,000-sale benchmark (NOT RUN), all nine P&L fields and full return/no-restock/stock-ledger coverage asserted, unused `react-day-picker` removed, dead `PlaceholderScreens.tsx` deleted; 96 tests (17 files) + 1 skipped opt-in benchmark; [Phase 6 review](PHASE6_REVIEW.md). |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 7 — Import/recovery    | NOT STARTED                    | CSV preview/import, backup/restore                                          |
| 8A — Sync engine       | NOT STARTED                    | Transport boundary and two-device tests                                     |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

## Active checkpoint record

- Phase / checkpoint: 6 / A and B (History, returns, expenses, reports) — independent review completed, all nine findings repaired.
- State: READY FOR HARDWARE CHECK.
- Base commit / result commit: base `bdc3d3d`, implementation `29f078d`, repair commit recorded below.
- Built: Sales history screen (`SalesScreen`) showing sales newest first, receipt search (`receipt_no` / note), date filter (`startDate`, `endDate`), per-day totals breakdown (count, revenue, refunds), detail / reprint reuses `ReceiptModal`, return modal with item quantities bounded by remaining sold quantity, restock / no-restock toggle per line, cash / online refund method, note, atomic batch execution via `ReturnRepo.processReturn` with in-batch limit guard (`_operation_guards`), synchronous double-submit ref guard, and in-modal error reporting; expense screen (`ExpensesScreen`) for expense list, add, edit, and soft-delete with validated date, positive integer amount, category, and note, attributed to the current device via `DeviceRepo`; reports screen (`ReportsScreen`) with quick presets (Today, Yesterday, Last 7 days, This month, Last month) and custom date range inputs, SPEC P&L cards (Net Revenue, Net COGS, Gross Profit, Expenses, Net Profit, Sales Count, Avg Sale Value, Cash Sales, Online Sales), Top 10 items tables by quantity and profit, and Recharts daily trend chart (`getDailySeries`).
- Review repairs (this commit): `ReturnRepo.getReturns`/`getReturnItems` zod-validated reads replace raw SQL in `SalesScreen`; return validation errors surface inside the return modal (no more throw-outside-try or errors hidden behind the overlay); `notifyStockChanged()` after restocking returns; expense saves use the loaded device id (no fabricated fallback) and a synchronous submitting ref; the benchmark test is honest (50-sale smoke, always run) with a real 1,000-sale benchmark opt-in via `VAPORFLOW_BENCH=1` (NOT RUN); P&L test asserts all nine fields on the canonical seed; returns coverage adds on-hand assertions (100 − 3 + 1 = 98), no-restock writes no movement (ledger stays at 3 rows), full-return path and post-full-return rejection, and netted P&L after returns (net_revenue 0, net_cogs 2400, net_profit −2400); unused `react-day-picker` removed; dead `PlaceholderScreens.tsx` deleted. Details in [Phase 6 review](PHASE6_REVIEW.md).
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (96 tests across 17 files, plus 1 skipped opt-in benchmark), `pnpm --filter @vaporflow/app build` PASS.
- Hardware/live checks: NOT RUN — physical printer and mobile device verification remain pending.
- Review findings: all nine resolved (2 HIGH, 3 MEDIUM, 4 LOW); none blocking.
- Known issues / required decisions: sales history loads all sales without pagination (revisit at Phase 7/8); history per-day refunds attribute to the sale's date while P&L attributes refunds to `returned_at` (documented inconsistency); recharts keeps the main bundle at 842 kB (232 kB gzip) — lazy-loading the reports screen is optional future work.
- Next action: Phase 7 (CSV import and backup/restore).

Never mark an unrun hardware check as passed.
