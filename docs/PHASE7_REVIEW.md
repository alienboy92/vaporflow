# Bali Hub POS — Phase 7 review

> Follow-up: [Phases 4–7 repair and current evidence](PHASE4_7_REPAIR.md) supersedes conflicting completion claims below.

Updated 16 November 2026. Scope: CSV product import and backup/restore. Implementation commit `c719865`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` is unchanged.

## What was built

- CSV import (`csv-import.ts` + ProductsScreen modal): PapaParse + Zod row validation with row numbers, template generation/download, duplicate-barcode detection in-file and in-DB, category creation and product grouping, variant matching by barcode then product/variant name, skip/update price strategies, one atomic batch per 200 rows with progress, and re-import that never repeats opening stock. The 2,000-row benchmark is honest (≈0.6 s, well under the 15 s acceptance).
- Backup/restore (`backup.ts` + SettingsScreen): versioned `.vfbackup` JSON export of all synced tables with soft deletions preserved; complete zod schema validation plus referential checks before restore; restore replaces all synced rows in one atomic batch (old data survives any failure by transaction) with every restored row marked `dirty = 1`; local-only settings (PIN, device identity) untouched; receipt counter recovered without reuse.

## Review findings and fixes

Independent review of `c719865` found ten issues; all are resolved:

1. **HIGH — receipt-counter recovery was a silent no-op, and off-by-one**: the recovery looked up a settings key `active_device_code` that exists nowhere (Phase 3 stores `active_device_id`; codes live in the devices table), so it never ran and its empty `catch` hid that. It also wrote `max + 1`, while the Phase 5 convention is that the counter stores **last-used** — writing max + 1 would permanently skip a number. Rewritten to recover from the max across **all** restored receipts (the counter is one global key, so a clean-install restore of any backup is covered) and to write the max itself. A clean-install restore now leaves the counter at the last-used number and the next sale continues after it — proven by a test that completes a sale on the restored database and asserts `PC1-000003` after two restored sales.
2. **HIGH — "Update prices" could destroy data**: the update wrote `data.barcode || null` / `data.sku || null`, nulling an existing variant's barcode/sku when the CSV row omitted them, and silently rebound a barcode when a name-matched row carried a different one. Updates now preserve existing barcode/sku/threshold when the row omits them, and a CSV barcode that conflicts with the matched variant's own barcode is rejected as a row error (both in preview and as an in-execute guard against stale previews) instead of silently merging.
3. **HIGH — restore acceptance was undemonstrated**: the old test seeded one product and asserted its name. New tests restore a seeded shop with sales, a restocked return, and an expense and assert stock on hand (10 − 3 + 1 = 8), sales/returns by ID, all nine P&L fields (net_revenue 2000, net_cogs 1000, gross 1000, expenses 100, net 900, count 2, avg 1500, cash 3000, online 0), every restored row `dirty = 1`, counter recovery, and post-restore sale continuation. A second new test fails a restore mid-batch (duplicate barcode violating `idx_variants_barcode_unique`) and proves the old data stays intact and usable, including a successful sale afterwards.
4. **MEDIUM — chunk failure aborted the import silently**: the per-chunk `db.batch` sat outside any error handling; one bad chunk threw away the whole run and the UI showed the error behind the open modal. Chunk failures are now caught and reported per row range ("chunk failed and wrote nothing… fix and import again"), later chunks continue, and re-running the import is deterministic because written chunks match as existing. The UI shows import errors inside the modal.
5. **MEDIUM — import double-submit guarded by React state only**: now uses the established synchronous ref guard (`csvImportingRef`), the same pattern as checkout/expense saves.
6. **MEDIUM — import attributed rows to the wrong device**: the CSV modal (and the pre-existing Phase 4 create/edit/category/stock paths) passed `shop.device_id` — the shop-creating device. All now load the current device via `DeviceRepo` and refuse to save with a clear message when none is registered.
7. **MEDIUM — backup export likely broken on Android**: the raw blob + `<a download>` path doesn't work in the Android webview. Export now goes through `platform.share.shareFile` (desktop blob download, Android cache write + share sheet), the same Phase 5 mechanism as receipts.
8. **LOW — CSV validation gaps**: `opening_stock` accepted negative/non-integer values (a negative "opening" movement corrupts stock); invalid `low_stock_threshold` silently became null. Both are now hard row errors.
9. **LOW — incomplete backup validation**: validation checked only sale_items→sale/variant and returns→sale. It now checks duplicate record IDs in every table, return_items→return/sale_item/variant, stock_movements→variant, products→category, variants→product, devices→shops, `shop_id` consistency against `backup.shop_id`, and that `backup.shop_id` exists in `tables.shops`.
10. **LOW — misc**: export now filters every table to the backup's shop (previously exported all rows), accepts an `app_version` parameter instead of a hardcoded `'1.0.0'`, and the restore Confirm button gained a synchronous double-click guard. The preview status column now distinguishes "Exists (barcode)" / "Exists (name)" / "New" instead of only flagging barcode matches.

## Verified correct (no change needed)

- Chunked 200-row batches are atomic; re-import creates no duplicates and never repeats opening stock (tested).
- Restore preserves IDs, price/unit-cost snapshots, history, and soft deletions exactly; restored rows are marked dirty.
- The `.vfbackup` schema is zod-validated before restore; local-only settings (PIN hash, device identity) are never exported and never touched by restore.

## Verification (run during the repair)

| Check | Result |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 105 tests, 18 files (was 102; +3 restore-safety tests), plus 1 skipped opt-in benchmark |
| `pnpm --filter @bali-hub-pos/app build` | PASS — 10.5 s; main chunk 892 kB (246 kB gzip), papaparse added ~50 kB |
| 2,000-row import acceptance | PASS — ~0.6 s (limit 15 s); second import: 0 imported, 2,000 skipped |

## Remaining acceptance (hardware/live)

NOT RUN and pending: Windows and Android round-trip smoke checks (import a real CSV on device, export/restore a backup on device, Android share-sheet handoff of the `.vfbackup` file), per the build prompt's requirement before enrolling real data in cloud sync. Carried over: Phase 2–6 device checks.

## Known issues / notes

- Ambiguous CSV matches (conflicting barcode on a name-matched row) are resolved by rejecting the row with an explanatory error rather than an interactive prompt; editing the CSV resolves it. An interactive per-row resolution dialog was deliberately not built in this phase.
- The counter is one global settings key shared by all devices; receipt numbers from another device prefix consume counter values as gaps on this device. Unchanged from Phase 5.
- Bundle size grew with papaparse (~50 kB); lazy-loading the import path/reports screen remains optional future work.
