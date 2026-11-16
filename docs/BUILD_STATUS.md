# VaporFlow — Build Status

Updated 16 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Current decision — 16 November 2026

**READY FOR LIVE DEPLOYMENT CHECK — Phase 8B (Auth, Cloud Enrollment, and Supabase Integration) is fully implemented and verified with automated tests.**

- Phase 8B Supabase Integration & Auth (`packages/core/src/sync/`, `packages/app/src/screens/SettingsScreen.tsx`):
  - `@supabase/supabase-js` client wrapper (`createVaporFlowSupabaseClient`) and RPC transport (`SupabaseSyncTransport`).
  - Auth integration: Email/password sign-up, sign-in, session persistence, sign-out, and pending-confirmation handling.
  - Shop claiming and enrollment: `claim_shop` RPC integration, pushing local shop data, joining existing shops.
  - Settings UI: Cloud & Sync panel with Supabase credentials configuration, auth controls, cloud claim action, live sync status (`synced`, `pending`, `offline`, `error`), pending count, last sync time, "Sync Now", and actionable sync problems list.
  - Documentation & config: `.env.example` placeholders (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) and `docs/SUPABASE_SETUP.md` (migration guidelines, security rules against replaying initial schema over deployed DBs, email confirmation handling).
  - Tests: 138 automated tests passing (including new Supabase client/transport/claim unit tests and 19 sync engine tests). Live cloud connection and cross-device synchronization on hosted Supabase remain pending live deployment authorization (READY FOR HARDWARE/LIVE CHECK).

- Next action: Phase 9 (Camera, OTG scanner, mobile finishing).

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
| 8B — Auth & Cloud  | READY FOR LIVE CHECK           | Supabase client wrapper, RPC transport, email/password Auth flows, shop claiming, Settings UI cloud panel with sync status, errors, sync now, and problems list; 138 automated tests passing; hosted live multi-connection tests pending live deployment. |

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

Never mark an unrun hardware check as passed.
