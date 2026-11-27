# Bali Hub POS — Phase 4 review

> Follow-up: [Phases 4–7 repair and current evidence](PHASE4_7_REPAIR.md) supersedes conflicting completion claims below.

Updated 15 November 2026. Scope: products, variants, and stock workflows. Implementation commit `cfe9fdd`, review-repair commit `c9a82c6`, badge-refresh commit `36dacb6`. `docs/SPEC.md` is unchanged.

## What was built

- Catalog: product/variant search by name, SKU, and barcode; category filter with inline creation; variant counts, price range, and total stock summaries; product create/edit modal with a multi-variant editor, per-unit profit/margin display, zero-price-safe handling, and a non-blocking below-cost warning.
- Barcodes: prefix-2 EAN-13 generation with valid checksums; duplicate live-barcode rejection across saves (clear repo error backed by the `variants(shop_id, barcode)` partial unique index) and within a single save (mid-batch unique-index failure with full rollback). Enter in barcode fields advances focus and never submits.
- Atomic writes: product + variants + opening-stock movements save in exactly one `DbAdapter.batch()`; multi-line Stock In and adjustments likewise. Opening movements are written only for variants with no prior movement, so editing or retrying can never repeat opening stock. Variant removal in the editor soft-deletes inside the same save batch.
- Stock: ledger-based on-hand (zero for variants with no movements); All/Low/Out/Negative filters; Low = ≤ effective threshold (variant override or shop default, equality counts); Out = ≤ 0; Negative = < 0; the navigation badge counts each variant once because it reads the single `getLowStockVariants` list. Per-variant history shows all movement types, newest first.
- Badge: shell refreshes immediately via an app-level `stock-changed` event emitted after every stock-affecting mutation, plus refresh on navigation and a 30 s fallback (`packages/app/src/utils/stock-events.ts`).

## Review findings and fixes

Independent review of `cfe9fdd` found six issues; all are resolved in `c9a82c6` and `36dacb6` with regression coverage:

1. **HIGH — editing a product silently doubled stock** for variants without a prior `'opening'` movement: the edit modal prefilled Opening Stock with current on-hand and submitted it as an opening movement, and the dedup guard only checked for `'opening'` movements. Reproduced at core level (restock +10, then edit → on-hand 20). Fixed in both layers: the UI only sends opening stock for newly added variant rows and hides the field for existing variants; `saveProductWithVariantsAndOpeningStock` now refuses opening movements for any variant that already has a movement. Regression test replays the exact failure sequence.
2. **MEDIUM — `docs/BUILD_PROMPTS.md` corrupted** in `cfe9fdd` (Prompt 3's opening line truncated to "n, then proceed."; "repoZsitories"). Both lines restored.
3. **MEDIUM — generated artifacts and session notes committed**: `apps/desktop/dist-electron/*` (~20k-line bundle) and `memory/` were tracked despite gitignore. Untracked in `c9a82c6`; `memory/` added to `.gitignore`.
4. **MEDIUM — coverage did not match the builder report** (3 tests; the rollback test was a single raw statement). `phase4.test.ts` now has 12 tests including a true mid-batch rollback over a composed catalog batch (product + variants + opening movement, asserting nothing survived), shop-default threshold equality, zero on-hand, Out/Negative filters with single badge count, validation-failure no-partial-write tests, and Stock In without a purchase price leaving `cost_price` unchanged.
5. **LOW — Stock In gaps**: the "optional" purchase price was always applied (rewriting `cost_price` and marking the variant dirty every restock), clearing the field crashed with a raw NaN binding error, and qty ≤ 0 rows were silently skipped while the UI reported success. Price is now genuinely optional (empty = keep current), quantities/prices are validated as positive/non-negative integers in both UI and repo, and invalid rows error out instead of being skipped.
6. **LOW — edit-modal UX**: "Remove" on an existing variant did nothing to the database, and the Opening Stock field was misleading. Existing variants now soft-delete in the same save batch, and the Opening Stock input is shown only for new variant rows. The below-cost warning now also covers a zero selling price.

## Verification (run during review and after the repair)

| Check | Result |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 66 tests, 10 files (12 in `phase4.test.ts`) |
| Core-level probe of the F1 doubling sequence | Reproduced on `cfe9fdd` (10 → 20); fixed and regression-tested on `c9a82c6` |
| Mid-batch rollback over a composed catalog batch | PASS — no product, variants, or movements survive |
| Barcode generation | PASS — 50-sample checksum/prefix assertions; duplicate rejection across saves and within one batch |

Adapter-level middle-statement rollback remains covered by the Phase 2 reusable contract tests; the Phase 4 tests add the batch-composition layer on top.

## Remaining acceptance (hardware/live)

Runtime behavior on real Electron and Android is NOT RUN and stays pending (the app cannot run in a plain browser):

1. Electron: create a product with three variants and opening stock, restart, verify persistence; restock +10, adjust, verify history and badge agreement; confirm the edit modal no longer shows Opening Stock for existing variants.
2. Android: same walkthrough at 390×844; Electron at 1366×768; keyboard navigation and ≥44 px touch targets; runtime console errors.
3. Phase 3 device checks (setup/PIN/idle-lock restart persistence) remain pending from that phase's review.

## Known issues / notes

- The schema has no foreign keys, so `stockIn` with an unknown variant id would insert a phantom ledger movement. UI paths always pass real ids; revisit before Phase 5's sale batches.
- Catalog/stock screens hardcode "PKR" instead of `shop.currency_code`; centralize when receipts are built in Phase 5.
- When Phase 5's sale flow changes stock, its completion handler must call `notifyStockChanged()` so the badge stays immediate.
- The rounding rule (remainder on the last line, even when negative) is untouched by this phase.
