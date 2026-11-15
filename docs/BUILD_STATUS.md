# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase              | State                          | Evidence                                                                                                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap      | READY                          | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema    | READY                          | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence    | READY FOR HARDWARE CHECK       | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |
| 3 — Setup/settings | REVIEW / DEVICE CHECKS PENDING | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md).                                                                                                           |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State                          | Next checkpoint                                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 3 — Setup/settings     | REVIEW / DEVICE CHECKS PENDING | Corrections and 53 automated tests; see [Phase 3 review](PHASE3_REVIEW.md). |
| 4 — Products/stock     | NOT STARTED                    | Catalog editor and atomic opening stock                                     |
| 5 — Checkout/output    | NOT STARTED                    | Receipt counter and sale completion                                         |
| 6 — History/reports    | NOT STARTED                    | History and returns                                                         |
| 7 — Import/recovery    | NOT STARTED                    | CSV preview/import, backup/restore                                          |
| 8A — Sync engine       | NOT STARTED                    | Transport boundary and two-device tests                                     |
| 8B — Cloud integration | NOT STARTED                    | Deployment-state inspection and Auth setup                                  |
| 9 — Mobile hardware    | NOT STARTED                    | Camera/OTG verification                                                     |
| 10 — Release           | NOT STARTED                    | Packaged install/update acceptance                                          |

## Active checkpoint record

- Phase / checkpoint: 3 / A and B.
- State: REVIEW / DEVICE CHECKS PENDING.
- Built: Shop and device repositories (`ShopRepo`, `DeviceRepo`), atomic first-run setup (`saveFirstRun`) with rollback on failure; setup wizard with shop name/address/phone, optional logo (max 256 px, <= 150 KB compression/resize), device code (PC1/PH1 validation), disabled cloud sign-in stub; shared navigation shell (SPEC §9.1) with desktop sidebar and Android bottom bar & More menu; header slots for sync status and low/out-of-stock badge; settings screen with shop details, logo toggle, receipt footer, default low-stock threshold, device info, PIN set/change/remove (secure hash via Web Crypto, no plaintext storage), idle auto-lock with activity timer and lock screen, app version, bounded copyable last-100 error log, and development diagnostic DB check; 53 unit/integration tests passing.
- Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (53 tests across 9 files), shared app build, desktop builder build PASS.
- Corrections: startup PIN gate and exclusive lock screen, immediate security-setting updates, idle/resume checks, recoverable shop-read errors, repository-only shop lookup, safe error-log locations, real repository rollback and React interaction regressions.
- Next action: independent review and Phase 3 Windows/Android restart, keyboard and layout checks before Phase 4. Hardware checks are not implied by passing automated tests.

Never mark an unrun hardware check as passed.
