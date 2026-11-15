# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md).

## Completed baseline

| Phase           | State                    | Evidence                                                                                                                                                                              |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap   | READY                    | Workspace/platform shells; baseline toolchain recorded in README.                                                                                                                     |
| 1 — Core/schema | READY                    | Correction commit `40a23e8`; [Phase 1 review](PHASE1_REVIEW.md).                                                                                                                      |
| 2 — Persistence | READY FOR HARDWARE CHECK | Code corrections, 43 tests, Electron native contract, packaged Windows restart check and Android APK build; [Phase 2 review](PHASE2_REVIEW.md). Android device acceptance is pending. |

Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests remain scheduled in 8B.

## Remaining work

| Phase                  | State       | Next checkpoint                            |
| ---------------------- | ----------- | ------------------------------------------ |
| 3 — Setup/settings     | NOT STARTED | Shared shell and first-run save            |
| 4 — Products/stock     | NOT STARTED | Catalog editor and atomic opening stock    |
| 5 — Checkout/output    | NOT STARTED | Receipt counter and sale completion        |
| 6 — History/reports    | NOT STARTED | History and returns                        |
| 7 — Import/recovery    | NOT STARTED | CSV preview/import, backup/restore         |
| 8A — Sync engine       | NOT STARTED | Transport boundary and two-device tests    |
| 8B — Cloud integration | NOT STARTED | Deployment-state inspection and Auth setup |
| 9 — Mobile hardware    | NOT STARTED | Camera/OTG verification                    |
| 10 — Release           | NOT STARTED | Packaged install/update acceptance         |

## Active checkpoint record

- Phase / checkpoint: 2 / A and B.
- State: READY FOR HARDWARE CHECK; independent review still required before Phase 3.
- Base commit: `0fbd710`. Implementation and regression tests: `fa804e8`.
- Built: portable ordered migrations; platform-owned async adapters; validated and sender-restricted IPC; platform provider; isolated development fixtures; shared contract scenarios; corrected native packaging and repeatable Windows smoke runner.
- Automated checks: lint and typecheck pass; 43 tests in six files pass; five actual Electron contract scenarios pass. Test cases cover real batch and migration failure rollback, not just successful migration reruns.
- Windows: unpacked package built and run twice in isolated storage; renderer/provider, preload, IPC, SQLite, rollback, migrations and restart persistence PASS. Node tests also pass after packaging without reinstalling dependencies.
- Android: diagnostics web build, SQLite plugin registration, and debug APK build PASS. Native contract and force-stop/reopen checks NOT RUN, explicitly deferred by the user.
- Not built: Phase 3 screens, auth, sync, deployment, printing/scanning/sharing/backup implementations, signed installers and release polish.
- Findings fixed: missing native mobile dependency and platform wiring; false plugin typings; absent renderer in package; bundled native loader; missing IPC validation; swallowed startup migration failure; production/normal-database fixture exposure; incomplete contract coverage; shared native ABI overwrite.
- Known limitations: Android runtime acceptance remains pending. Windows smoke is unsigned and is not an installer/update acceptance test. Hardware steps and exact commands are in [PHASE2_REVIEW.md](PHASE2_REVIEW.md).
- Next action: independent Phase 2 review; run the deferred phone checks before marking Phase 2 READY.

Never mark an unrun hardware check as passed.
