# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | READY FOR HARDWARE CHECK       | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |
| 4 — Products/stock | READY FOR HARDWARE CHECK       | Catalog editor, EAN-13 barcode generator, opening stock guard, soft-deletes, inventory filters, stock in/adjustments, and 66 tests. |
| 5 — Checkout/output    | READY FOR HARDWARE CHECK       | Review repairs: unique receipt numbers (migration 003 + lost-race rollback), 80mm print via hidden iframe, A4 3×8 label sheets with scannable EAN-13 SVG barcodes, receipt PDF share (Android sheet / desktop save), percent/amount discounts, scan-not-found create offer, double-submit guard; 92 tests; [Phase 5 review](PHASE5_REVIEW.md). |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 5 — Checkout/output    | READY FOR HARDWARE CHECK       | History and returns (Phase 6)                                               |
| 6 — History/reports    | NOT STARTED                    | History and returns                                                         |
| 7 — Import/recovery    | NOT STARTED                    | CSV preview/import, backup/restore                                          |
| 8A — Sync engine       | NOT STARTED                    | Transport boundary and two-device tests                                     |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

## Active checkpoint record

- Phase / checkpoint: 5 / A, B, and C (+ independent review repair).
- State: READY FOR HARDWARE CHECK.
- Base commit / result commit: base `e94c94f`; implementation `bdc3d3d`; review repair pending commit.
- Built: Per-device receipt counter (`receipt_counter` in `settings`, stored value = LAST-USED number, next = value + 1) incremented atomically inside the same `completeSale` batch as sales, sale_items, and stock_movements; failed batches consume no counter number; concurrent completions race the unique partial index `idx_sales_receipt_no_unique` (migration 003) — the loser rolls back loudly without consuming a number and the retry gets the next number; full offline checkout screen (`SaleScreen`) with always-focused keyboard-wedge scan/search input, rapid scanning support, exact barcode/SKU matching, keyboard shortcuts (`F2` focus scan, `F9` complete sale, `Esc` clear cart with confirmation), quantity adjusters, price override, item removal, amount OR percent discount (one at a time, integer-safe via core `roundRatio`), payment method toggle (cash/online), cash received & change calculation with a non-blocking cash-short warning, non-blocking negative stock warnings, synchronous double-submit guard (`completingRef`) against same-tick double-F9, scan-not-found offer that opens the product create modal with the scanned barcode prefilled, and catalog reload after each sale; 80mm receipt printing through a hidden-iframe document (`printHtml`) with an `@page 80mm` stylesheet — never the whole POS page; A4 label printing (3 × 8 = 24 labels/page) for selected variants with name, price, and scannable EAN-13 barcodes rendered by a dependency-free core SVG encoder (`encodeEAN13Modules`); receipt sharing as a real PDF (dependency-free generator, xref-offset verified) via `share.shareFile` — Android: cache write + share sheet (`@capacitor/filesystem` + `@capacitor/share`), desktop: blob download; reusable 80mm receipt modal showing all SPEC 9.3 fields with Print, Share PDF, and New Sale actions.
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (92 tests across 16 files) PASS. Regression coverage: sequential numbering, failed-batch counter rollback, concurrent-completion lost race + retry gets next number, close/reopen counter persistence (file-based adapter), movement note contains the computed receipt number, EAN-13 encoder structure/parity/round-trip, PDF structural validity (xref offsets point at `N 0 obj`), receipt HTML field coverage/escaping, barcode SVG geometry, and share-adapter behaviour with plugin doubles.
- Hardware/live checks: NOT RUN — Electron print dialog (80mm paper), Android share sheet with the generated PDF, label scannability on a real scanner, and camera/OTG scan finishing (Phase 9) are pending device verification.
- Review findings: F1 Checkpoint C missing (fixed: print/labels/share implemented, whole-page `window.print()` removed); F2 receipt counter race + missing unique index (fixed: migration 003, probe confirmed one loser rolls back and retry gets the next number); F3 movement note stored "Sale receipt undefined" (fixed: uses computed receipt_no, ledger rows stay immutable); F4 percent discount missing (added); F5 scan-not-found create offer (added); F6 same-tick double-F9 (synchronous ref guard); F7 cash-short completes silently (non-blocking warning added); F8 stale catalog after sale (reloads); F9 "New Sale (F9)" label mismatch (renamed — F9 does not act while the modal is open). All resolved; full detail in the [Phase 5 review](PHASE5_REVIEW.md).
- Known issues / required decisions: none blocking; PDF receipts are text-only (no logo image) — the printed HTML receipt includes the logo.
- Next action: owner hardware checks (Electron print dialog & Android share), then Phase 6 (History, returns, expenses, reports).

Never mark an unrun hardware check as passed.
