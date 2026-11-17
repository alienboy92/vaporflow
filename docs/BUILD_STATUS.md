# VaporFlow — Build Status

Updated 17 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Current decision — 17 November 2026

**Phase 8B CLOSED for software: implementation, review repairs, and LIVE HOSTED acceptance all executed and passing. Phase 9 (Camera, OTG scanner, mobile finishing) is unblocked — Android toolchain verified and the debug APK builds with the current code.**

Live hosted acceptance (17 Nov 2026) against `https://qdgfnpmmphlvsdkggabf.supabase.co` — schema deployed via Dashboard SQL editor, email confirmation off, two disposable accounts, executed by the env-gated `packages/core/src/sync/supabase-live.test.ts`: **6/6 PASS** (hosted Auth sign-up/sign-in/sign-out; `claim_shop`; two-engine convergence through the real `sync_push`/`sync_pull` RPCs; full second-device enrollment over the network with counter recovery; concurrent claim contention; interrupted-enrollment retry against the hosted cloud; signed-out denial; second-account authorization denial including batch-rejected rogue push). Details: [Phase 8B review](PHASE8B_REVIEW.md), how to re-run: [SUPABASE_SETUP.md §4](SUPABASE_SETUP.md).

Phase 9 readiness: JDK 17 + Android SDK Platform 34 + Build-Tools 34.0.0 verified; `@vaporflow/mobile` Vite build, `cap sync android`, and `gradlew assembleDebug` all succeed (debug APK built with the current code, including 8B). A physical phone is needed for the on-device work.

Still NOT RUN (needs physical hardware / wall-clock, cannot run from one machine): airplane-mode sell-then-reconnect convergence between a real Windows PC and a real Android phone; kill/restart of the app process mid-pull on a device; session expiry over a real ~1-hour window. See the review doc.

- Next action: Phase 9 (Camera, OTG scanner, mobile finishing) — connect an Android phone.

### Review repairs (16 Nov 2026 — 8 findings, all resolved)

- **App-lifetime cloud session** (`packages/app/src/context/CloudSyncProvider.tsx`): exactly ONE `@supabase/supabase-js` client and at most ONE `SyncEngine` per app run — created once, `start()`ed on connect/restore, `stop()`ed on sign-out/config change/unmount (no orphaned engines or per-click clients breaking `autoRefreshToken`). Status polled every 5 s so the Settings badge stays live.
- **Sync triggers wired**: `saleCompleted()` fires from the sale screen after `completeSale`; app-start, network-return, and interval triggers come from the engine's `start()`. Previously the engine never ran autonomously in the app.
- **Session/enrollment restore on app start**: persisted `supabase_url`/`supabase_anon_key`/`cloud_enrolled_shop_id`, `auth.getSession()`, and automatic engine restart for an enrolled device with a live session (interrupted-enrollment recovery).
- **Second-device enrollment built** (`packages/core/src/sync/enrollment.ts` + first-run wizard "Join an existing shop" tab): empty-device guard, read-only shop probe BEFORE `claim_shop` (claim would silently create a placeholder shop for a typo'd ID), membership claim, random device code unique against CLOUD device codes, full pull with null cursors, receipt-counter recovery (max last-used, Phase 5 convention), device code shown after joining. Rejected on non-empty devices and while offline.
- **Setup wizard join flow**: new-shop / join-shop mode toggle replacing the disabled placeholder; ref-based double-submit guard; `busy`-aware buttons.
- **Settings cloud panel** rebuilt on the provider context: credential save with https/placeholder validation, auth actions with surfaced errors, claim action, Shop ID display + copy button (for second devices), registered-devices list, honest status from polling.
- **Tests**: 152 passing (was 138) + 2 skipped — new Supabase transport error-path tests (RPC errors throw, non-array pull data → `[]`, arg validation before RPC) and 6 second-device enrollment tests against two real SQLite databases (unique code vs cloud, full pull, counter recovery = max last-used, empty-device guard, offline guard, interrupted-retry device reuse). Lint, typecheck, and app build pass.

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
| 8B — Auth & Cloud  | LIVE ACCEPTED (software) — hardware checks pending | App-lifetime cloud session/provider with ONE client + ONE engine, autonomous sync triggers (post-sale, interval, network return, app start), session/enrollment restore on restart, second-device join flow (probe → claim → unique device code → full pull → counter recovery), Settings cloud panel on polled context state; 152 tests + 2 skipped passing; **live hosted acceptance 6/6 PASS** (auth, claim, two-engine convergence, enrollment over the network, contention, retry, signed-out + second-account denial); [Phase 8B review](PHASE8B_REVIEW.md). NOT RUN: physical two-device airplane-mode convergence, app-process kill/restart on device, ~1 h session expiry. |

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

Never mark an unrun hardware check as passed.
