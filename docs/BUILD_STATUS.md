# Bali Hub POS — Build Status

Updated 17 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Current decision — 17 November 2026

**Phase 8B CLOSED for software: implementation, review repairs, and LIVE HOSTED acceptance all executed and passing. Phase 9 (Camera, OTG scanner, mobile finishing) is unblocked — Android toolchain verified and the debug APK builds with the current code.**

Live hosted acceptance (17 Nov 2026) against `https://qdgfnpmmphlvsdkggabf.supabase.co` — schema deployed via Dashboard SQL editor, email confirmation off, two disposable accounts, executed by the env-gated `packages/core/src/sync/supabase-live.test.ts`: **6/6 PASS** (hosted Auth sign-up/sign-in/sign-out; `claim_shop`; two-engine convergence through the real `sync_push`/`sync_pull` RPCs; full second-device enrollment over the network with counter recovery; concurrent claim contention; interrupted-enrollment retry against the hosted cloud; signed-out denial; second-account authorization denial including batch-rejected rogue push). Details: [Phase 8B review](PHASE8B_REVIEW.md), how to re-run: [SUPABASE_SETUP.md §4](SUPABASE_SETUP.md).

Phase 9 readiness: JDK 17 + Android SDK Platform 34 + Build-Tools 34.0.0 verified; `@bali-hub-pos/mobile` Vite build, `cap sync android`, and `gradlew assembleDebug` all succeed (debug APK built with the current code, including 8B). A physical phone is needed for the on-device work.

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
| 9 — Mobile hardware | ON-DEVICE VERIFIED (partial) — OTG scan pending | `ScannerAdapter` via `@capacitor-mlkit/barcode-scanning` with permission denial/cancellation safety; camera scan buttons wired in SaleScreen (scan field), ProductsScreen (each variant barcode input), and Stock In rows (scan-to-select variant by barcode); USB-over-OTG wedge toggle (`inputMode="none"` vs manual, persisted preference, soft keyboard suppressed in wedge mode); Android Back via a LIFO dialog registry (receipt, return, reprint, expense, restore, product/CSV, stock modals close first; sale cart confirm only when the cart holds items; minimize at the sale root); shared `ScanControls` component; back-nav + wedge unit tests; 159 tests + 8 skipped passing; desktop NSIS and Android APK builds passing. **On-device (Galaxy A05s/Android 15)**: camera scan works after the permission prompt, denied permission shows a visible alert, wedge suppression + persistence verified, Back modal→navigate→minimize chain verified, lock-on-relaunch verified, barcode→cart add and the cart-abandon confirm (cancel keeps / OK clears + minimizes) verified; walkthrough bugs fixed — plugin ships no CAMERA permission (now declared and auto-patched by `scripts/android.ps1`) and the abandon confirm now actually clears the cart. NOT RUN: real OTG scanner input, 20-barcode camera sweep, full 390×844 walkthrough; [Phase 9 review](PHASE9_REVIEW.md). |

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 9 — Mobile hardware    | READY FOR HARDWARE CHECK       | On-device camera & OTG scanner walkthrough                                  |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

Never mark an unrun hardware check as passed.

## Product cleanup — 19 November 2026

Development-only surfaces were removed and the shipped UI was brought to a consistent production state. No schema, sync, money, or stock rules changed; the full automated suite still covers them.

- **Diagnostics removed end-to-end**: deleted the `DbCheck` screen (`packages/app/src/screens/DbCheck.tsx`), `core/src/dev-check.ts`, the Settings "Development Diagnostics" section, the `DiagnosticsAdapter`/`diagnostics` fields in the platform bridge, the desktop main/preload wiring, the mobile entry wiring, and the `build:diagnostics` scripts in the app/mobile packages.
- **Placeholder code deleted**: removed `screens/Placeholder.tsx` and the unused `printer`/`file` runtime stubs (the SPEC-defined `PrinterAdapter`/`FileAdapter` interfaces remain). The camera-unavailable message now says "not available on this device" instead of naming a phase.
- **Single version source**: `packages/core/src/version.ts` exports `APP_VERSION = '1.0.0'`; Settings displays it and backup export defaults to it, removing the hand-maintained `0.8.0 (development build)` string.
- **Currency correctness**: every money surface now uses the shop's `currency_code`/`currency_decimals` — product price ranges and per-unit profit, stock price and movement unit cost, sales list totals/refunds, sale cart totals/change, reports P&L and top-products, expenses, and the receipt modal. Product CSV preview and price labels no longer hard-code `PKR`.
- **Sample/default data removed**: the stock-in form no longer pre-fills `qty: 10` or the note "Restock shipment"; fields start empty with real placeholders.
- **UI/UX consistency**: receipt search placeholder matches the `PC1-000001` receipt format; `window.alert` calls in sales, expenses, and the receipt modal became inline errors; the Expenses total card matches the P&L card structure; the "Below stock (negative allowed)" label is clearer; the desktop mobile header now reads "Desktop POS"; phase-number comments were removed from production files and the README no longer advertises placeholder/coming-soon states.
- **Stale artifacts**: untracked `memory/`, empty build folders, `dist`/`out` output, `*.tsbuildinfo`, and Android Gradle build output were deleted. The generated `apps/mobile/android` project is kept.
- **Test infrastructure**: the adapter contract now builds its own shop/product/variant fixture and runs `db.migrate()` instead of depending on removed dev fixtures. Automated suites for money, stock, reports, and sync are unchanged.

Verification on 19 November 2026: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` → 166 passed, 8 skipped (opt-in hosted/benchmark checks), 0 failed across 27 passing files. The hosted Supabase live suite and physical-device checks listed above remain the only unrun items.

## Printing — 19 November 2026

- **Root cause**: Android's Capacitor WebView does not implement `window.print()`, so the hidden-iframe print path failed on the phone.
- **Native printer plugin**: new tracked workspace package `packages/capacitor-printer` (Capacitor 6 Android plugin) renders the document in a hidden WebView and hands it to `PrintManager`, opening the system print dialog (including "Save as PDF"). It is registered automatically by `cap sync`; the generated `apps/mobile/android` project stays ignored.
- **Platform wiring**: `PrinterAdapter` is now part of `PlatformAdapters`. Desktop/web uses the browser print dialog; Android uses the native plugin. Receipts, return receipts, and A4 label sheets all go through `platform.printer`.
- **Product form clarity**: removed the Manual/Scanner toggle from the create/edit product header; renamed "Threshold Override" to "Low-stock alert at" with the shop default shown in the placeholder; marked SKU as optional with an example and tooltip; added "Units already on hand" help under opening stock.

Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (166 passed / 8 skipped), `pnpm --filter @bali-hub-pos/mobile build`, `npx cap sync android`, and `gradlew assembleDebug` → BUILD SUCCESSFUL with `:bali-hub-pos-capacitor-printer` included. On-device print dialog acceptance still needs a device/print service.

## Clear Data — 19 November 2026

- **Settings → Danger Zone → Clear Data**: full local reset. `packages/core/src/reset.ts` (`resetLocalDatabase`) drops every table and view, including `_migrations`, in one `DbAdapter.batch()`, then re-runs `db.migrate()` so the app restarts at the setup wizard. Shop, catalog, stock, sales, returns, expenses, PIN, receipt counter, enrollment and cloud credentials are all removed; the cloud copy and other devices are untouched.
- **Confirmation**: a modal requires typing `DELETE`; the Android back button closes it; the button is disabled with an explanation while a cloud account is signed in (`sync.email` set). After a successful reset the app clears `localStorage` preferences and reloads.
- **Tests**: `packages/core/src/reset.test.ts` covers full wipe + schema recreation, restored ledger immutability triggers, and running the reset twice.

Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` → 169 passed, 8 skipped, 0 failed.

18 November retest — 167 automated tests passed and 8 opt-in checks were skipped in the default run. Three dedicated hosted auth/sync tests passed separately. On the connected SM-A055F, 20 generated barcode fixtures and a repeated-barcode test passed via Android keyboard events. The phone layout audit found a narrow camera button. Repairs and outstanding physical acceptance checks are recorded in the [Phase 8B review](PHASE8B_REVIEW.md) and [Phase 9 review](PHASE9_REVIEW.md).

22 November 2026 · RC1 baseline tagged locally as v1.0.0-rc1 at 2a9b3e5. Clean-clone verification pending.
