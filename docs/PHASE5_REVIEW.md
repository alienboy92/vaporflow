# VaporFlow — Phase 5 review

> Follow-up: [Phases 4–7 repair and current evidence](PHASE4_7_REPAIR.md) supersedes conflicting completion claims below.

Updated 16 November 2026. Scope: offline checkout, receipts, and labels. Implementation commit `bdc3d3d`, review-repair commit `edb176e`. `docs/SPEC.md` is unchanged.

## What was built

- Core (`SaleRepo.completeSale`): one atomic batch writes the receipt-counter upsert, the sale, all sale items (DB-authoritative unit-cost snapshots with in-batch `_operation_guards` re-checks), and one negative sale movement per line. Failed batches consume no counter number. The stored counter value means **last-used**; the next receipt uses value + 1. Migration `003_receipt_unique.sql` adds the unique partial index `idx_sales_receipt_no_unique` on `sales(shop_id, receipt_no) WHERE deleted_at IS NULL` (bundle regenerated), so a lost concurrent race fails loudly and rolls back without consuming a number.
- Checkout (`SaleScreen`): always-focused keyboard-wedge scan/search input (F2), rapid scanning, exact barcode/SKU matching, F9 complete / Esc clear shortcuts, quantity and price controls, **amount or percent discount** (one at a time; percent converted integer-safe via core `roundRatio`), cash/online toggle, cash received with change due and a **non-blocking cash-short warning**, negative-stock warnings that never block, a **synchronous double-submit guard** (`completingRef`) against same-tick double-F9, a **scan-not-found offer** that opens the product create modal with the scanned barcode prefilled, and a catalog reload after each completed sale.
- Receipt output: the modal prints through a hidden-iframe document (`printHtml` util) with an 80mm `@page` stylesheet — printing exactly the receipt, never the POS page. Share builds a real PDF (dependency-free generator with verified xref offsets) and hands it to `platform.share.shareFile`: Android writes to cache and opens the share sheet (`@capacitor/filesystem` + `@capacitor/share`), desktop saves via blob download.
- Labels (`ProductsScreen`): per-product Labels modal with variant checkboxes (invalid non-EAN-13 barcodes are skipped with a note), printing A4 sheets of 24 labels (3 × 8) with name, price, and scannable barcodes rendered by the new core EAN-13 encoder (`encodeEAN13Modules` / `ean13BarRuns`, no new dependency).

## Review findings and fixes

Independent review of `bdc3d3d` found nine issues (two probe-confirmed); all are resolved with regression coverage:

1. **HIGH — Checkpoint C missing**: `window.print()` printed the whole POS page (no print stylesheet existed), there was no A4 label printing at all, and Share only sent text. Fixed with the hidden-iframe print path, the label sheet modal, the core EAN-13 encoder, and real PDF file sharing on both platforms. The report had claimed an "80mm CSS print stylesheet" that did not exist.
2. **HIGH — receipt numbering not concurrency-safe (probe-confirmed)**: the counter was read outside the batch and there was no unique index; two concurrent completions both committed `PC1-000001`. Fixed by migration 003 plus a clear conflict error; the regression test proves exactly one commit survives, the loser rolls back (counter still at the winner's value), and the retry receives `PC1-000002`.
3. **MEDIUM — ledger note "Sale receipt undefined" (probe-confirmed)**: the movement note used the optional *input* `receipt_no` instead of the computed one, corrupting every auto-numbered sale's immutable ledger row. Fixed; a test asserts the note contains `PC1-000001`.
4. **MEDIUM — percent discount missing**: added with a mode toggle; only one mode applies at a time and percent conversion stays integer-safe.
5. **MEDIUM — scan-not-found dead end**: the error now offers "Create product with this barcode", navigating to the products screen with `prefillBarcode` state; the create modal opens prefilled and the state is cleared after use.
6. **LOW — same-tick double-F9 could double-submit**: React state cannot update between two keydowns in one frame; the decision now uses a synchronous ref checked by both the F9 handler and `handleCompleteSale`.
7. **LOW — cash-short completion was silent**: a non-blocking warning now shows when cash received is below the total (the sale itself still succeeds, as designed).
8. **LOW — stale catalog after a sale**: the catalog panel reloads after completion, so stock displays match the ledger.
9. **LOW — "New Sale (F9)" label mismatch**: renamed to "New Sale" (F9 does not act while the modal is open), and BUILD_STATUS now documents the counter semantics.

## Verification (run during the repair)

| Check | Result |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 92 tests, 16 files (was 69; +6 core phase-5, +5 barcode encoder, +11 app util, +4 share adapter) |
| Concurrency probe (pre-fix evidence) | Two completions both got `PC1-000001`; post-fix exactly one commits, retry gets `PC1-000002` |
| Movement note probe (pre-fix evidence) | `"Sale receipt undefined"`; post-fix `Sale receipt PC1-000001` |
| PDF structural validity | xref offsets point exactly at each `N 0 obj`; startxref points at the xref table |
| EAN-13 encoder | 95 modules, guard/center patterns, per-first-digit parity, R-coded right digits, round-trip on generated codes |
| `npx cap sync android` | PASS — 3 plugins registered (`sqlite`, `filesystem`, `share`) |

The migration-count regression test now asserts idempotency over the three migrations instead of a hardcoded 2.

## Remaining acceptance (hardware/live)

Runtime behavior on real Electron and Android is NOT RUN and stays pending:

1. Electron: print a receipt with the system dialog on 80mm paper; verify page size and layout; label sheet on A4; scan a printed label with a real scanner.
2. Android: share a receipt (cache write → share sheet → receiving app), confirm the PDF opens; repeat the print/label checks at 390×844.
3. Carried over: Phase 2 Android acceptance, Phase 3 setup/PIN/idle-lock restart checks, Phase 4 device walkthrough.

## Known issues / notes

- PDF receipts are text-only; the shop logo appears on the printed HTML receipt but not in the shared PDF (recording a logo in a PDF without dependencies is left out of scope).
- `PrinterAdapter.printReceipt/printLabels` remain unsupported stubs on purpose (silent printing is not in scope); the iframe print path is the active mechanism.
- Non-EAN-13 barcodes (user-typed) cannot be rendered by the label encoder and are skipped with a visible note in the label modal.
- The rounding rule (remainder on the last line, even when negative) is untouched.
