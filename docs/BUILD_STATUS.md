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
| 7 — Import/recovery    | READY FOR HARDWARE CHECK       | CSV import with Papaparse & Zod, template generation, preview & error detection, duplicate barcode checks, chunked batches (200 rows), skip/update price strategies, and opening stock idempotence; settings backup export (`.vfbackup`) and validation/restore with transaction safety and counter recovery; 102 automated tests; [Phase 7 review pending]. |
| 8A — Sync engine       | NOT STARTED                    | Transport boundary and two-device tests                                     |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

## Active checkpoint record

- Phase / checkpoint: 7 / A and B (CSV Import and Backup/Restore)
- State: READY FOR HARDWARE CHECK
- Built: CSV product import via PapaParse and Zod (`csv-import.ts`), supporting template generation (`generateCsvTemplate`), live preview with error validation, duplicate file/database barcode checks, category creation/product grouping/variant matching, skip vs update price strategies, 200-row chunked atomic batches (`DbAdapter.batch`), progress tracking, and idempotent opening stock handling (preventing duplicate opening movements on re-import); settings backup export (`.vfbackup` JSON containing all synced tables) and robust validation/restore (`backup.ts`) with transaction safety, resetting/restoring synced rows with `dirty = 1`, preserving local device identity/code, PIN hash, and recovery of receipt counter without reuse (`receipt_counter` recovery from max sales receipt number). UI integration in Products screen (`Import CSV` modal with template download, file upload, preview table, and progress bar) and Settings screen (`Export Backup` and `Restore Backup` with validation, warning confirmation modal, and auto-reload).
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (102 tests passed across 18 test files, including 2,000-row CSV import performance test in <1s and backup/restore tests), `pnpm --filter @vaporflow/app build` PASS.
- Hardware/live checks: NOT RUN — Windows and Android round-trip import/restore smoke checks remain pending.
- Review findings: None (new phase implementation).
- Known issues / required decisions: Large CSV files (>10k rows) should be imported in chunks (2,000 rows takes <0.7s).
- Next action: Phase 8A (Sync engine and simulated devices).

Never mark an unrun hardware check as passed.
