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
| 5 — Checkout/output    | READY FOR HARDWARE CHECK       | Atomic receipt counter increment (`settings`), checkout screen (`SaleScreen`), keyboard shortcuts (F2, F9, Esc), barcode wedge & search, quantity/price overrides, discount allocation, cash/online payment with change calculation, non-blocking negative stock handling, real 80mm reusable receipt modal, print/share/new sale actions, and 69 tests. |

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

- Phase / checkpoint: 5 / A, B, and C.
- State: READY FOR HARDWARE CHECK.
- Base commit / result commit: base `bb9387d`; implementation pending commit.
- Built: Per-device receipt counter (`receipt_counter` in `settings`) incremented atomically inside the same `completeSale` batch as sales, sale_items, and stock_movements (failed batches consume no counter number; repeated F9/double-clicks cannot duplicate submissions); full offline checkout screen (`SaleScreen`) with always-focused keyboard-wedge scan/search input, rapid scanning support (3 rapid scans -> quantity 3), exact barcode/SKU matching, keyboard shortcuts (`F2` focus scan, `F9` complete sale, `Esc` clear cart with confirmation), quantity adjusters, price override, item removal, discount amount calculation, payment method toggle (cash/online), cash received & change calculation, non-blocking negative stock warnings; reusable 80mm receipt modal (`ReceiptModal`) showing all SPEC 9.3 fields (logo if enabled, shop details, receipt number, date/time, items, subtotal, discount, total, payment method, amount received, change, footer) with Print, Share/Copy, and New Sale actions; 69 passing unit and integration tests.
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (69 tests across 11 test files) PASS. Regression tests added for sequential receipt number generation (`PC1-000001`, `PC1-000002`), transaction rollback on invalid variant with zero counter consumption, and non-blocking negative stock sales.
- Hardware/live checks: device/environment → NOT RUN (Electron print dialog and Android receipt share/scannability checks pending).
- Review findings: None so far; independent review requested for Phase 5.
- Known issues / required decisions: None.
- Next action: owner hardware checks (Electron print dialog & Android share), then Phase 6 (History, returns, expenses, reports).

Never mark an unrun hardware check as passed.
