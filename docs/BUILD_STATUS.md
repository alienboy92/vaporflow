# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | READY FOR HARDWARE CHECK       | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |
| 4 — Products/stock | READY                          | Catalog editor, EAN-13 barcode generator, atomic opening stock and retry check, barcode uniqueness, soft-deletes, inventory list with filters, multi-line stock in, adjustments, history, and 56 tests. |

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

- Phase / checkpoint: 4 / A and B.
- State: READY.
- Built: Product catalog search by name/SKU/barcode, category filter, variant counts, price range, total stock; product create/edit with inline category creation, brand, notes, active status, quick multi-variant editor; purchase price and selling price with per-unit profit and margin display, safe zero-price handling and non-blocking below-cost warning; EAN-13 prefix-2 barcode generation, barcode focus advancement on Enter, duplicate live barcode rejection; atomic save of products, variants, and opening stock movements through core (with retry guard preventing duplicate opening stock movements); soft-delete with confirmation and historical snapshot preservation; inventory list with All, Low, Out, and Negative filters and ledger-based on-hand calculation (with unique badge counting); multi-line Stock In with quantity, optional purchase price update, and notes in one atomic batch; stock adjustment with counted quantity and required note (skipping unchanged zero movements); per-variant movement history; responsive desktop/mobile UI screens (`ProductsScreen`, `StockScreen`); 56 unit/integration tests passing.
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (56 tests across 10 files) PASS.
- Hardware/live checks: device/environment → NOT RUN.
- Review findings: none.
- Known issues / required decisions: none.
- Next action: Phase 5 (Offline checkout, receipts, labels).

Never mark an unrun hardware check as passed.
