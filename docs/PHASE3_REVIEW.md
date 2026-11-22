# Phase 3 correction review

Corrections applied after review of `abcbe93`. SPEC.md and the user's existing BUILD_PROMPTS.md edits are unchanged.

## Changes

- Startup loads PIN settings before mounting protected navigation. A configured PIN requires unlock on startup. Locked state renders only LockScreen: protected routes, drawer, buttons and links are unmounted.
- Security-settings reads fail closed with Retry. PIN and idle-timeout changes notify the shell immediately. Idle expiry uses elapsed wall time, checks visibility/focus after suspension, and rejects overdue activity before resetting the clock. Unlock resets the idle deadline. Lock controls are disabled when no PIN exists.
- Failed shop lookup shows a retry screen rather than starting another setup wizard. Shell shop lookup uses ShopRepo; UI contains no SQL.
- PIN set/change/remove uses one shared core operation; incorrect current PIN and malformed new PIN leave stored credentials unchanged.
- Error logs retain a generic failure summary and filtered source-file locations only. Arbitrary error messages, validation payloads, original stack headers and arbitrary thrown objects are never retained. This intentionally sacrifices raw error detail to avoid retaining secrets. The log remains bounded to 100 entries.
- Replaced the misleading direct-batch rollback test with an injected failure on the final statement of the actual saveFirstRun method, checking that shops, devices and settings are all empty afterward and retry succeeds.
- Added React interaction tests to the root test discovery patterns. Tests exercise startup locking, inaccessible navigation while locked, security-read failures, immediate settings updates, idle locking with an open drawer, and setup retry after a failed read. Pure regressions also cover wall-clock expiry and log safety.
- Updated the packaged desktop smoke's expected startup screen from the Phase 2 placeholder to the Phase 3 setup wizard.

## Verification

Verified in this correction pass: lint PASS, typecheck PASS, all 53 tests PASS, Windows unpacked build and packaged smoke PASS, Android diagnostics build/plugin sync/debug APK PASS. No corrected APK was installed onto the phone during this pass. React Router future-version notices and existing native build warnings remain non-fatal.

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (53 tests across 9 files). Run `pnpm --filter @vaporflow/desktop build:unpacked` then `pnpm --filter @vaporflow/desktop smoke` for isolated packaged startup, IPC, migration, rollback and restart-persistence checks. This smoke does not claim full interactive setup/PIN acceptance.

## Remaining acceptance

Phase 3 physical-device and interactive layout checks remain pending:

1. Windows and Android: save setup and shop settings, close/force-stop, reopen, and verify values.
2. Set a PIN, reopen, and confirm only unlock UI is accessible. Wrong PIN must fail. Unlock with the correct PIN; test change and removal with wrong/correct current PINs.
3. Enable idle lock. Open More or Settings, wait the configured time (also test backgrounding), and confirm protected navigation cannot be reached by keyboard or touch. Unlock, repeat, and verify removal disables locking immediately.
4. Inspect 1366×768 and 390×844 layouts, keyboard navigation, touch targets, logo controls and runtime errors.

No Phase 4 features, cloud work or production data changes were made. PIN storage still uses the existing salted SHA-256 implementation; this is a casual local lock, not encrypted storage or resistance to offline PIN guessing. Independent review and pending device checks are required before claiming Phase 3 fully accepted.
