# Bali Hub POS — Build Plan and Copy-Paste Prompts

Version 2.0 · 15 November 2026 · Companion to SPEC v1.1

**Next action: run Prompt 8A locally. Phases 4–7 repairs and automated checks are complete; hardware acceptance remains pending. See BUILD_STATUS.md and PHASE4_7_REPAIR.md.**

This revision changes delivery order, not the product specification. Every original v1 feature remains in scope. Keep this repository file as the working copy. Numbers from the previous plan are mapped below; do not mix the two sequences.

## 1. Why this order is better

| Previous source of rework                                                        | Revised approach                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Checkout arrives before receipt numbering and receipt output                     | Build the complete sale-to-receipt workflow together                                   |
| CSV and labels delay a usable checkout                                           | Build the core offline workflow first; share printing work between receipts and labels |
| Sync combines algorithm work, authentication, deployment, and hardware debugging | Separate local engine tests (8A) from cloud/device integration (8B)                    |
| Backup arrives after cloud connection                                            | Verify recovery before enrolling real data in sync                                     |
| Native database problems can survive until packaging                             | Check persistence and packaged SQLite in Phase 2                                       |
| Broad repeated reviews rediscover the same issues                                | Review concrete changes at checkpoints and keep one status record                      |
| Completion summaries overstate verification                                      | Require actual commands, assertions, test counts, and hardware evidence                |

The aim is less rework and fewer handoffs, not fewer tests or a promised completion time. Larger phases have small internal checkpoints and commits. If context runs low, record the next action and resume the same phase; do not restart it.

## 2. Existing baseline — preserve this work

- Phase 0: workspace, shared UI shell, Electron/Capacitor shells, Android scripts, and checks are complete.
- Phase 1 correction: commit `40a23e8`. At that commit, lint, typecheck, and **29 tests**, including eight PostgreSQL tests, passed. This is historical evidence, not a claim about future changes.
- Read `docs/PHASE1_REVIEW.md` before changing core/database code.
- The public `DbAdapter` is Promise-based. The Node-only SQLite test adapter lives in `packages/core/src/testing`; do not import it into the app.
- Apply both SQLite migrations, in order: `001_initial.sql`, `002_integrity.sql`. The second provides transaction guards and ledger protection.
- PostgreSQL has local PGlite coverage, not a hosted deployment. Live Auth/HTTP and multi-connection contention still need verification.
- Preserve the owner's approved rounding behavior: the remainder goes on the last line, **even when its total becomes negative**. Do not silently clamp it in UI, receipts, returns, reports, or exports.
- Use the established Android toolchain, README, and `pnpm doctor:android`. Do not upgrade tools just because newer releases exist.
- Inspect `git status` before work. Existing desktop build artifacts may already be modified; preserve unrelated changes.

## 3. Delivery map

| New prompt   | Deliverable                           | Depends on | Original v1.1 prompts  |
| ------------ | ------------------------------------- | ---------- | ---------------------- |
| 0 — complete | Bootstrap                             | —          | 0                      |
| 1 — complete | Core/schema and corrections           | 0          | 1                      |
| **2**        | Persistent SQLite on both platforms   | 1          | 2                      |
| 3            | Shop setup, navigation, settings      | 2          | 3; diagnostics from 13 |
| 4            | Products, variants, stock workflows   | 3          | 4 except labels; 6     |
| 5            | Checkout, receipts, labels            | 4          | 7; 8; labels from 4    |
| 6            | History, returns, expenses, reports   | 5          | 9; 11                  |
| 7            | CSV import and backup/restore         | 6          | 5; backup from 13      |
| 8A           | Sync engine and simulated devices     | 7          | Engine/test part of 10 |
| 8B           | Auth, cloud connection, second device | 8A         | Integration part of 10 |
| 9            | Camera, OTG scanner, mobile finishing | 8B         | 12                     |
| 10           | Release builds and final acceptance   | 9          | Remaining work from 13 |

Milestones:

1. After 2: reliable storage on Windows and Android.
2. After 5: complete offline product → sale → receipt workflow.
3. After 7: complete offline shop workflow with a verified recovery path.
4. After 8B: both devices synchronize successfully.
5. After 10: release candidate with recorded acceptance evidence.

## 4. Working method

1. Use a fresh session for each numbered phase, and separate sessions for 8A and 8B. Paste the relevant prompt below; it includes the shared rules by reference.
2. Ask for a short plan followed by implementation in the same session. Routine implementation choices do not need a separate approval session.
3. Complete one internal checkpoint at a time. Extend existing code and tests rather than recreating the foundations.
4. The builder performs automated checks. The owner only performs steps requiring their hardware, credentials, or authorization.
5. Independently review after **2, 5, 7, 8A, 8B, and 10**. Review earlier if a change substantially affects money, ledgers, schema, auth, or recovery.
6. Fix confirmed findings with the repair prompt. Do not rerun the entire build prompt or discard working code.
7. Update `docs/BUILD_STATUS.md` at every checkpoint. Failed required checks block dependent work. Unavailable hardware checks stay pending; independent preparation can continue, but the phase is not accepted.
8. End with **READY**, **READY FOR HARDWARE CHECK**, or **BLOCKED**, plus the precise next action.

### Shared rules — part of every build prompt

- Read AGENTS.md, SPEC.md, this baseline, and BUILD_STATUS.md. Never edit SPEC.md. Ask about genuine product ambiguities; continue independent work while waiting.
- Build only the active phase. Inspect existing code before adding dependencies, abstractions, migrations, or files. Preserve unrelated changes.
- TypeScript strict, no `any`; Zod at external boundaries; UUID v7; integer money/quantities. Reuse core arithmetic and local-date helpers.
- Business/database logic belongs in core repositories. No SQL in UI. Every atomic operation uses exactly one awaited DbAdapter.batch().
- Cloud is never in the sale path. Do not weaken ledger protections or authorization to make a workflow pass.
- Build desktop and mobile layouts together. English UI, keyboard support, touch targets at least 44 px. Phase 9 is hardware finishing, not the first responsive-layout pass.
- Test changed money, stock, reports, sync, and restore behavior. Include real failure/rollback assertions. Never replace existing coverage with a smaller happy-path suite or claim coverage from test titles.
- Run focused tests while implementing. Before finishing, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, plus the phase's platform checks. Repeat broad checks only after further changes or unresolved failures.
- Commit relevant work as `phaseN: summary`; use `phase8:` for 8A/8B. Never commit credentials, signing files, generated artifacts, or real shop data.
- Record actual commands, results, test counts, file references, commits, and manual checks. A builder summary is not proof. Performance claims must identify dataset, platform, build mode, and measured time.
- Reuse fixture/seed helpers. Avoid speculative optimization, blanket refactors, and unrelated dependency upgrades.

## 5. Build prompts

### Prompt 2 — Persistent database adapters

```text
Implement revised Phase 2 in docs/BUILD_PROMPTS.md. Follow its shared rules. Read docs/PHASE1_REVIEW.md. Give a short plan, then proceed.

Goal: the same repository calls persist correctly on Windows and Android.

Checkpoint A — contract and migrations
- Reuse the Promise-based DbAdapter; keep Node imports out of the shared runtime.
- Package ordered SQL for both platforms. Android cannot depend on Node filesystem paths. Adapt migrate() consistently if needed and update its consumers/tests together.
- Apply both existing migrations, record _migrations only after successful application, and make reapplication harmless. A failed migration must not remain partially applied.
- Define the other SPEC 5 interfaces, including ScannerAdapter, with only the working implementations or honest stubs needed now.

Checkpoint B — implementations
- Electron: better-sqlite3 in the main process, WAL, foreign keys, database in app.getPath('userData'), typed/validated preload IPC. Keep contextIsolation on and nodeIntegration off. Configure native rebuild/packaging for the installed Electron version.
- Capacitor: @capacitor-community/sqlite, identical schema, atomic batch semantics.
- Provide the adapter/repository provider for future screens.
- Add a development-only DB check through core: create a fixture shop/product/variant, show counts, restart, read them back. No SQL in UI or automatic writes into a real shop.

Acceptance
- Reusable contract tests: query values/nulls, batch commit, forced middle-statement failure with full rollback, migration ordering/idempotence/failure. Run against test and Electron adapters; run equivalent contract smoke checks on Android.
- Verify data after restarting both apps.
- Build/run a packaged desktop smoke artifact now to catch native SQLite problems; final installer polish stays in Phase 10.
- Run root checks and record unavailable hardware checks explicitly.

Out of scope: real screens, auth, sync, deployment. Commit, update BUILD_STATUS.md, and request independent review before Phase 3.
```

### Prompt 3 — Setup, navigation, settings

```text
Implement revised Phase 3 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — reusable shell
- SPEC 9.1 navigation: desktop sidebar; Android bottom bar and More. Header slots for sync and Stock badge, without pretending cloud is connected.
- Build only UI pieces needed now: layout, forms, dialogs, loading/empty/error states. Reuse them later.

Checkpoint B — local first run and settings
- Shop/device repositories and atomic first-run save; failure must not leave partial setup.
- Wizard: shop name/address/phone, optional logo <=256 px and under the SPEC size limit; unique device code compatible with PC1/PH1 examples.
- Existing-shop sign-in remains visible but disabled until 8B.
- Settings: shop details, logo/show-logo toggle, receipt footer, default low-stock threshold, device info, PIN set/change/remove and idle auto-lock. Do not add new currency-management features.
- Add app version and a bounded, copyable last-100-error log now so later integration failures are diagnosable. Never log credentials or sensitive payloads.
- Remove the temporary DB check from normal navigation; retain only as a development diagnostic if useful.

Acceptance
- Setup/settings survive restart on both platforms; forced setup failure rolls back.
- PIN lifecycle and idle locking work; no plaintext PIN storage.
- Verify 1366x768 and 390x844, keyboard use, touch targets, and runtime console errors.

Out of scope: inventory screens, sales, cloud, backup. Run root checks, commit, and update BUILD_STATUS.md.
```

### Prompt 4 — Products and stock together

```text
Implement revised Phase 4 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — catalog
- Search by name/SKU/barcode; category filter; variant counts, price range, total stock.
- Product create/edit: category with inline creation, brand, notes, active status, quick multi-variant editor.
- Required fields labelled Purchase price and Selling price. Show per-unit profit/margin, handle zero price safely, and warn without blocking when selling below cost.
- Variant name, SKU, barcode, threshold override, opening stock. A simple product uses Default, hidden when redundant.
- Save product/variants/opening movements atomically through core. Editing/retrying must not repeat opening stock.
- Enter in barcode fields advances focus, never submits. Reject duplicate live barcodes. Generate valid EAN-13 prefix-2 barcodes unique per shop.
- Deactivate/soft-delete with confirmation. Preserve historical snapshots.

Checkpoint B — stock
- All/Low/Out/Negative filters and on-hand from the ledger, including zero for variants with no movements.
- Low <= effective threshold; Out <=0. Count a variant once in the navigation badge even if it matches both.
- Multi-line Stock In with scan/search, quantity, optional new purchase price, note. Movements and price changes use one batch.
- Adjustment: counted quantity and required note; write the difference atomically. An unchanged count must not create a zero movement.
- Per-variant history includes all movement types.

Acceptance
- Create three variants and opening stock; test barcode uniqueness and soft-delete behavior.
- Restock +10, correct adjustment, threshold equality/default/override, history and badge agreement.
- Inject failures into catalog/restock batches and assert full rollback.
- Check both layouts. Labels are Phase 5; CSV is Phase 7.

Out of scope: checkout, printing, import, cloud. Run root checks, commit, and update BUILD_STATUS.md.
```

### Prompt 5 — Offline checkout, receipts, labels

```text
Implement revised Phase 5 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — atomic numbering and completion
- Add the per-device receipt counter inside the SAME completeSale batch as sale/items/movements. Document whether the stored counter means next or last-used, and keep recovery consistent.
- Failed batches consume no number. Repeated F9/double clicks cannot duplicate a submission. Test concurrent completion and restart behavior.
- Preserve snapshots, list_price/overrides, discount allocation and negative final-line rounding. Percent conversion uses integer-safe core math.

Checkpoint B — checkout and receipt
- Always-focused keyboard-wedge input: exact barcode adds/increments; otherwise name/SKU search; not found offers creation with barcode prefilled.
- Restore focus except during deliberate field editing. F2 focuses scan; F9 completes a nonempty cart; Esc confirms clearing.
- Quantity controls/type entry, price override, removal, amount/percent discount, cash/online, optional cash received/change, nonblocking stock warnings. Negative stock never blocks a sale.
- Desktop two-column/mobile single-column layout. Completion opens a real reusable 80 mm receipt, not a placeholder.
- All SPEC 9.3 fields, saved snapshots, optional enabled logo, Print, Share/Save, New Sale.

Checkpoint C — output
- Windows system print dialog with 80 mm receipt layout; silent printing remains a stub.
- Android receipt PNG/PDF sharing; desktop save/open through the appropriate adapters.
- Products: selected variants print A4 labels, 3 x 8, with barcode/name/price through the same print infrastructure.

Acceptance
- Three rapid scans produce quantity 3. Test simulated keyboard input and record physical scanner evidence when available.
- Offline scan-to-cart <200 ms and completion <1 second, measured on target hardware. Restart preserves sale and counter.
- Batch failure leaves no sale/items/movements/counter increment; repeated completion input creates one sale.
- Correct receipt/label previews, readable Android share, physically scannable labels.

Out of scope: history/return UI, CSV, cloud, camera. Run root checks, commit, update BUILD_STATUS.md, and request independent review.
```

### Prompt 6 — History, returns, expenses, reports

```text
Implement revised Phase 6 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — history and returns
- Sales newest first, receipt search, date filter, per-day totals; detail/reprint reuses the saved receipt.
- Return lines/quantities bounded by remaining sold quantity, restock/no restock, cash/online refund, return receipt.
- Use the existing core operation and its in-batch limit guard. Prevent repeated UI submissions. No edit/delete of sales or returns.
- Cover partial/full/no-restock, repeat/concurrent attempts, and exact refund rounding; do not change the approved rounding rule.

Checkpoint B — expenses and reports
- Expense list/add/edit/soft-delete with validated date, amount, category, note.
- Today, Yesterday, Last 7 days, This month, Last month, custom local date range via react-day-picker.
- All SPEC cards, top-10 tables, recharts daily chart. Queries/formulas stay in core. Preserve and clearly label the existing report semantics in PHASE1_REVIEW.md.
- Seeded assertions remain: revenue 6000, COGS 2400, gross profit 3600, expenses 500, net profit 3100, sales 2, average 3500, cash sales 5000, online sales 2000.
- Add a reproducible development-only benchmark: 50,000 sales over 12 months; also exercise SPEC 11's 10,000-variant/100,000-movement scale. Never seed real shop data automatically.

Acceptance
- One offline sale → return → expense → report scenario matches the core assertions.
- Empty ranges, local midnight boundaries, later-period returns, and cost edits after sale are tested.
- Range changes update every card/table/chart. A 12-month report loads in <2 seconds on the declared benchmark environment. Measure before optimizing; no speculative stock cache.

Out of scope: CSV, new exports/report types, cloud. Run root checks, commit, and update BUILD_STATUS.md.
```

### Prompt 7 — Import and recovery before cloud

```text
Implement revised Phase 7 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — CSV
- Template columns: category, product_name, variant_name, barcode, sku, cost_price, sale_price, opening_stock, low_stock_threshold.
- papaparse + Zod; row preview/errors for missing prices, invalid numbers, duplicate barcodes in file/database.
- Group product_name/category into products. Match existing variants by barcode, else product_name + variant_name. Ask about genuinely ambiguous matches instead of silently merging unrelated products.
- Skip existing or Update prices, user confirmation of valid rows, one batch per 200 rows, progress, deterministic retries. Re-import must not repeat opening stock.

Checkpoint B — backup/restore
- Settings exports one versioned .vfbackup JSON containing all synced tables. Validate the complete backup before restoring.
- Confirmation, replacement of local data, restored synced rows marked dirty. Preserve IDs, snapshots, history, soft deletions exactly.
- Design around ledger protections: prefer staging/validating a replacement database and safely activating it. Do not create a normal UI path to mutate ledger history. Atomic database writes use one batch; interrupted activation must preserve a usable original database.
- Document handling of local-only device identity/code, receipt counter, PIN, and cursors before implementation. Recover counters without reuse; reset stale sync state appropriately; never export credentials. Ask about restore/device-identity choices if SPEC does not determine them.
- Test corrupt/truncated/unsupported files, inconsistent references, interruption, and clean-install restore. Preserve recovery of the old database until success.

Acceptance
- Import 2,000 rows in <15 seconds on the declared environment. Second import creates no duplicates. Failed chunk writes nothing partial.
- Restore reproduces stock, sales, returns and seeded P&L. Invalid backup or failed restore leaves old data usable.
- Windows and Android round-trip smoke checks pass before enrolling real data in cloud sync.

Out of scope: auth/cloud, cloud backup services. Run root checks, commit, update BUILD_STATUS.md, and request independent import/restore review.
```

### Prompt 8A — Sync engine, locally verified

```text
Implement revised Phase 8A in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Goal: isolate sync correctness before live Auth, deployment, and device debugging. Realistic fixtures are sufficient; a cloud deployment is not needed for engine tests.

- Minimal transport interface matching existing sync_push/sync_pull RPCs. Test with two actual SQLite databases and fake transport; retain separate PostgreSQL integration coverage.
- Push <=200 dirty rows in foreign-key dependency order. Retry safely: insert-only ledgers, updated_at last-write-wins for mutable rows. Clear dirty only for the exact version acknowledged; edits during an in-flight push remain pending.
- Pull ordered by (server_updated_at,id), <=500 per page; 5-second overlap at cycle start. Preserve timestamp precision and cursor ties. Apply page and cursor in one batch; never advance past uncommitted rows.
- Preserve a dirty newer mutable local row. Ledger pulls insert idempotently and update permitted metadata only, never protected business fields.
- Explicit Zod conversion of server/local booleans, nulls, UUIDs and timestamps.
- One sync at a time; exponential backoff; app-start/network/30-second/2-second-after-sale/manual triggers. Use fake clocks rather than long sleeps in tests.
- Expose status, pending counts, last success and row-specific problems for 8B UI. Rejected rows cannot disappear silently or permanently prevent all valid data from syncing.

Acceptance
- Both devices sell offline and converge to summed stock, identical sales/totals.
- Test mutable conflicts, soft deletes, duplicate barcode conflict, interruption/retry, edits during push, page rollback/restart, timestamp ties, overlap, long offline catch-up, and overlapping run attempts.
- Network failure never blocks local sales.
- Exercise production-shaped payloads against PostgreSQL RPCs, not only a permissive fake server. Identify unresolved cross-device return-limit conflicts; local guards do not coordinate disconnected devices.

Out of scope: hosted deployment, real sign-up/session storage, enabled cloud UI. Run root checks, commit as phase8:, update BUILD_STATUS.md, and independently review before 8B.
```

### Prompt 8B — Auth, cloud enrollment, second device

```text
Implement revised Phase 8B in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed. Reuse the tested engine.

Checkpoint A — integration preparation
- Verify current official Supabase documentation and existing migration state. Never replay initial CREATE TABLE migrations over a deployed database.
- Environment/build config for URL and anon/public client key; placeholders in .env.example. No service_role in app or repository secrets.
- Exact migration/setup instructions and email-confirmation behavior, including pending-confirmation sign-in handling. Prepare first; execute hosted changes only after authorization for the concrete deployment.
- Confirm a usable local backup before enrolling real data. Use disposable shops/accounts for destructive integration checks.

Checkpoint B — enrollment and UI
- Email/password sign-up/sign-in, platform-appropriate persistent session. An initialized local shop stays usable offline or when cloud auth needs attention.
- Connect cloud: claim local shop, push existing data, synchronize. Preserve real shop details and recover interrupted enrollment.
- Existing-shop setup only on an empty device: unique device code, full pull, counter recovery using Phase 5's next/last-used convention, then normal use.
- Actual Synced/Pending N/Offline/Error, last-sync details, Sync now, actionable Sync problems.

Acceptance
- Live RPC/Auth/HTTP behavior, two-account authorization denial, enrollment retries, and multi-connection claim contention on an isolated test target.
- Windows + phone airplane-mode test: sell on both, reconnect, stock/sales/totals match within a minute. Kill/restart during sync without loss or duplication.
- Session expiry and interrupted onboarding do not corrupt or reset the local shop.
- Preserve SQLite/fake-server/PostgreSQL tests. Unperformed live/hardware checks remain pending.

Out of scope: new business features, release distribution. Run root checks, commit as phase8:, update BUILD_STATUS.md, and independently review security/sync.
```

### Prompt 9 — Camera, OTG scanner, mobile finishing

```text
Implement revised Phase 9 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

- ScannerAdapter using @capacitor-mlkit/barcode-scanning in Sale, Stock In, product barcode fields. Permission denial/cancellation returns safely to the current workflow.
- Real USB-over-OTG keyboard-wedge behavior. Avoid unwanted soft-keyboard popups; retain an obvious manual-entry option and intentional field editing.
- Audit every screen at 390x844: bottom navigation, >=44 px targets, loading/error states, no accidental horizontal scroll.
- Android Back closes dialogs first and confirms before abandoning an active sale. Preserve desktop shortcuts.
- Fix existing hardware/layout issues; no wholesale redesign.

Acceptance
- Scan 20 different barcodes by camera and OTG; repeated scans, cancellation, denied permission, background/resume.
- Phone walkthrough: setup, products, stock, sale, receipt/share, return, expense/report, backup, sync problems.
- Distinguish physical tests from simulations and unavailable equipment.

Out of scope: new features, thermal ESC/POS. Run root checks and both platform builds, commit, update BUILD_STATUS.md.
```

### Prompt 10 — Release candidate and acceptance

```text
Implement revised Phase 10 in docs/BUILD_PROMPTS.md, following its shared rules. Give a short plan, then proceed.

Checkpoint A — packaging
- Windows NSIS via electron-builder: icon, per-user install, launch after install, SQLite native module included, userData survives updates.
- Debug APK instructions and signed Android release build. Provide keystore creation/storage steps; never commit signing files/passwords. Ask for required signing input rather than inventing it.
- Clean-machine installation and upgrade from an earlier build with fixture data, including migration-failure recovery. Preserve the established toolchain unless a documented blocker requires change.

Checkpoint B — operations
- Verify existing backup/restore in packaged apps; do not rebuild it here.
- SPEC weekly Supabase keep-alive GitHub Action: repository secrets, minimum permissions, harmless request. Verify current service behavior; a keep-alive job is not a backup or uptime guarantee.
- Check Phase 3 app-version/error-log behavior in release builds and absence of credentials in logs.
- Review SPEC 11 and every pending BUILD_STATUS entry. Complete required checks or explicitly identify the blocker.

Acceptance
- Installer works on a clean Windows machine/VM and update preserves data.
- Signed APK installs/runs on phone.
- Packaged restore, real scan/print/share, offline sales, two-device sync and interruption checks have evidence.
- Root checks and release builds pass; no unresolved critical/important correctness or data-loss findings.
- Deliver PASS/FAIL/NOT RUN matrix, actual artifact paths, install/update/recovery commands, known limitations. Required NOT RUN checks prevent a release-ready claim.

Out of scope: v2 features, public distribution without authorization. Commit as phase10:, update BUILD_STATUS.md, request final independent review.
```

## 6. Independent review prompt

```text
Review revised Phase [NUMBER] in docs/BUILD_PROMPTS.md. Read AGENTS.md, SPEC.md, BUILD_STATUS.md and relevant handoff notes. This is review, not permission to implement fixes.

Review the actual diff from [BASE COMMIT] through [HEAD COMMIT], including applicable uncommitted changes. Check affected dependencies, but do not flag scheduled future features as missing.

1. Compare implementation with phase acceptance and SPEC.
2. Run lint/typecheck/tests and available relevant builds. Report real counts/failures; inspect test assertions, not titles.
3. Prioritize reproducible money/stock/return/report defects, rollback/concurrency, data loss, sync, auth/RLS and platform regressions.
4. Each finding: severity, file/line, trigger/reproduction, expected vs actual, smallest appropriate fix. Separate confirmed defects from unverified risks.
5. Identify unperformed hardware/live checks. Never infer success from a builder summary.

End READY, READY FOR HARDWARE CHECK, or BLOCKED, with blockers and evidence needed next. Do not edit code/spec or deploy. Do not pad with speculative improvements.
```

## 7. Focused repair prompt

```text
Repair revised Phase [NUMBER] only. Read AGENTS.md, SPEC.md, docs/BUILD_PROMPTS.md and BUILD_STATUS.md.

Confirmed findings:
[Paste reviewer findings with reproductions and file references.]

Reproduce each finding or explain precisely why it does not apply. Add regression coverage demonstrating the actual failure, then make the smallest coherent fix. Preserve unrelated work and existing tests. Never weaken validation or expectations to make tests pass.

Run focused checks, then root checks and affected platform checks. Update BUILD_STATUS.md with resolved findings, command/results and remaining issues. Commit as phaseN: summary. Do not claim completion with unverified blocking findings.
```

## 8. Resume prompt

```text
Continue revised Phase [NUMBER] of docs/BUILD_PROMPTS.md. Read BUILD_STATUS.md, AGENTS.md, SPEC.md and relevant handoff notes; inspect git status and commits.

Resume at the recorded next action. Verify current checkpoint evidence, preserve existing work, and complete only the remaining phase scope. Do not rerun bootstrap, regenerate working architecture, or automatically start the next phase. Update BUILD_STATUS.md before stopping.
```

## 9. Completion record template

Use this compact block in BUILD_STATUS.md. Keep completed entries short; link detailed reports/test files.

```text
Phase / checkpoint:
State: NOT STARTED | IN PROGRESS | READY FOR HARDWARE CHECK | READY | BLOCKED
Base commit / result commit:
Built:
Not built (scheduled later):
Automated checks: command -> result, test count, relevant files
Hardware/live checks: device/environment -> PASS / FAIL / NOT RUN
Review findings: resolved/open, with references
Known issues / required decisions:
Next action:
```

Phases 0 and 1 are completed milestones, not new prompts. For a separate fresh repository, the original bootstrap/core plan is historical material and must be supplemented with the Phase 1 corrections. Do not rerun those phases in this project.
