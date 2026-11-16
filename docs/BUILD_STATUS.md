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
| 6 — History/reports| READY                          | Sales history list newest first, receipt search, date filter, per-day totals, detail/reprint receipt modal; return lines/quantities bounded by remaining sold quantity, restock/no-restock, cash/online refund, return receipt with core atomic batch & limit guard; expense list/add/edit/soft-delete with validated date, amount, category, note; P&L report cards, top-10 tables (qty and profit), daily series Recharts trend chart with presets (Today, Yesterday, Last 7 days, This month, Last month) and custom dates; seeded P&L assertions match; reproducible development benchmark (50 sales) executes successfully; 96 tests passing. |

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

- Phase / checkpoint: 6 / A and B (History, returns, expenses, reports).
- State: READY.
- Base commit / result commit: base `bdc3d3d`.
- Built: Sales history screen (`SalesScreen`) showing sales newest first, receipt search (`receipt_no` / note), date filter (`startDate`, `endDate`), per-day totals breakdown (count, revenue, refunds), detail / reprint reuses `ReceiptModal`, return modal with item quantities bounded by remaining sold quantity, restock / no-restock toggle per line, cash / online refund method, note, atomic batch execution via `ReturnRepo.processReturn` with in-batch limit guard (`_operation_guards`), and submission double-guard; expense screen (`ExpensesScreen`) for expense list, add, edit, and soft-delete with validated date, positive integer amount, category, and note; reports screen (`ReportsScreen`) with quick presets (Today, Yesterday, Last 7 days, This month, Last month) and custom date range inputs, SPEC P&L cards (Net Revenue, Net COGS, Gross Profit, Expenses, Net Profit, Sales Count, Avg Sale Value, Cash Sales, Online Sales), Top 10 items tables by quantity and profit, and Recharts daily trend chart (`getDailySeries`); seeded assertions match (revenue, COGS, gross profit, expenses, net profit, sales count, averages, cash/online split); reproducible development benchmark test verifying rapid report and bulk sale load times (<3 seconds for bulk operations).
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (96 tests across 17 files) PASS.
- Hardware/live checks: NOT RUN — physical printer and mobile device verification remain pending.
- Review findings: none blocking.
- Known issues / required decisions: none.
- Next action: Phase 7 (CSV import and backup/restore).

Never mark an unrun hardware check as passed.
