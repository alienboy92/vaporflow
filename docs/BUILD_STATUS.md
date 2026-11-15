# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | READY FOR HARDWARE CHECK       | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |
| 4 — Products/stock | READY FOR HARDWARE CHECK       | Catalog editor, EAN-13 barcode generator, atomic opening stock and retry guard, barcode uniqueness, soft-deletes, inventory filters, multi-line stock in, adjustments, history, immediate badge refresh, and 66 tests after review repair; review findings all resolved. |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 5 — Checkout/output    | NOT STARTED                    | Receipt counter and sale completion                                         |
| 6 — History/reports    | NOT STARTED                    | History and returns                                                         |
| 7 — Import/recovery    | NOT STARTED                    | CSV preview/import, backup/restore                                          |
| 8A — Sync engine       | NOT STARTED                    | Transport boundary and two-device tests                                     |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

## Active checkpoint record

- Phase / checkpoint: 4 / A and B (+ independent review repair).
- State: READY FOR HARDWARE CHECK.
- Built: Product catalog search by name/SKU/barcode, category filter, variant counts, price range, total stock; product create/edit with inline category creation, brand, notes, active status, quick multi-variant editor; purchase price and selling price with per-unit profit and margin display, safe zero-price handling and non-blocking below-cost warning; EAN-13 prefix-2 barcode generation, barcode focus advancement on Enter, duplicate live barcode rejection; atomic save of products, variants, and opening stock movements through core (opening movements only for variants with no prior movement, so editing/retrying can never repeat opening stock); variant removal soft-deletes inside the same save batch; soft-delete with confirmation and historical snapshot preservation; inventory list with All, Low, Out, and Negative filters and ledger-based on-hand calculation (with unique badge counting); multi-line Stock In with quantity, optional purchase price update (empty = keep current), and notes in one atomic batch, with positive-integer quantity validation; stock adjustment with counted non-negative integer quantity and required note (no zero movements); per-variant movement history; low-stock badge refreshes immediately via an in-app stock-changed event (with 30 s fallback and refresh on navigation); responsive desktop/mobile UI screens (`ProductsScreen`, `StockScreen`); 66 unit/integration tests passing.
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (66 tests across 10 files) PASS. Regression tests added for: edit-after-restock opening-stock guard, mid-batch catalog rollback (product + variants + movements), Stock In / adjustment validation with no partial writes, shop-default threshold equality, zero on-hand, Negative filter with single badge count, variant removal soft-delete in-batch, immediate low-stock badge refresh.
- Hardware/live checks: device/environment → NOT RUN (Electron + Android restart/layout checks still pending from Phases 3–4).
- Review findings: F1 stock-doubling on edit (fixed, regression-tested); F2 BUILD_PROMPTS.md corruption (restored); F3 generated artifacts/session notes untracked and ignored; F4 missing rollback/threshold/filter coverage (added); F5 Stock In validation and optional price (fixed); F6 edit-modal variant removal and Opening Stock field (fixed). No open findings.
- Known issues / required decisions: schema has no foreign keys, so `stockIn` with an unknown variant id would insert a phantom ledger movement; UI paths always pass real ids — revisit before Phase 5 sale batches. Currency is hardcoded as "PKR" in catalog/stock screens; centralize when building receipts in Phase 5.
- Next action: owner hardware checks (Electron + Android: restart persistence, product/stock workflow, both layouts), then Phase 5 (Offline checkout, receipts, labels).

Never mark an unrun hardware check as passed.
