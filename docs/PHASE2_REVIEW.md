# Bali Hub POS — Phase 2 correction and verification

Updated 15 November 2026. Implementation commit: `fa804e8`. Scope: platform persistence only. `docs/SPEC.md` is unchanged.

## Corrections

- Moved the Capacitor adapter into `apps/mobile`, installed the real Capacitor 6 SQLite plugin, removed fake ambient plugin types, and wired platform selection through the shared provider. Startup errors remain visible with a retry action.
- Added validated Electron IPC payloads and checks for the expected window, main frame and URL. The sandboxed preload exposes only named methods. Migration failure stops startup.
- Bundled both SQL migrations without Node filesystem imports. The bundle is generated with `node scripts/bundle-migrations.js`; a test compares it to the original SQL. Each migration and its journal entry share a transaction. Concurrent migration calls are serialized/coalesced.
- Reused contract scenarios for the test adapter, actual Electron adapter, and Capacitor adapter with a SQLite-backed plugin double. Failures really execute an invalid middle statement and an invalid migration, then inspect rollback and the journal.
- Added explicit fixture creation and read-back in a development diagnostic screen. Diagnostic databases are separate from the real shop database. Packaged desktop builds have neither fixture IPC handlers nor a diagnostic bridge; Android diagnostics require an explicit diagnostics build.
- Corrected renderer packaging, externalized native SQLite instead of bundling its Node loader, and separated typecheck output from executable output. Packaging includes only the main/preload entry points and renderer assets.
- Isolated Electron SQLite 12.10.0 from Node test SQLite 12.11.1. The explicit Electron rebuild uses production dependencies only; electron-builder's broader rebuild is disabled. This avoids overwriting the Node test binary. Do not merge these versions without rechecking both runtimes.

## Verification

| Check                                                     | Result                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                               | PASS                                                                                                                                  |
| `pnpm typecheck`                                          | PASS                                                                                                                                  |
| `pnpm test`                                               | PASS — 43 tests, 6 files                                                                                                              |
| `pnpm --filter @bali-hub-pos/desktop test:contract`          | PASS — 5 scenarios against Electron 33's actual native adapter                                                                        |
| `pnpm --filter @bali-hub-pos/desktop build:unpacked`         | PASS                                                                                                                                  |
| `pnpm --filter @bali-hub-pos/desktop smoke`                  | PASS — packaged renderer/provider, sandboxed preload, IPC, migrations, rollback and data persistence across two separate app launches |
| Node tests after desktop packaging                        | PASS — no dependency reinstall required                                                                                               |
| Android diagnostics renderer build and `cap sync android` | PASS — SQLite 6.0.2 registered                                                                                                        |
| Android `assembleDebug`                                   | PASS — native SQLite plugin compiled into APK                                                                                         |
| Android fixture and restart persistence                   | PASS — reported by user                                                                                                               |
| Android native adapter checks                             | RERUN PENDING — migration test formatting corrected after device failure                                                              |

The Capacitor tests on this machine use a plugin API double backed by real SQLite. They verify adapter behavior, not the Android native bridge. The Windows smoke uses temporary isolated storage, never the normal shop database.

## Run locally

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @bali-hub-pos/desktop test:contract
pnpm --filter @bali-hub-pos/desktop build:unpacked
pnpm --filter @bali-hub-pos/desktop smoke
```

Windows artifact: `apps/desktop/out/win-unpacked/Bali Hub POS.exe`. Use `pnpm dev:desktop` for the development fixture screen. Printing, sharing, backups and camera scanning are explicit unsupported stubs until their scheduled phases.

## Phone acceptance

Build diagnostics explicitly; the ordinary Android runner rebuilds production assets and therefore hides this screen.

```powershell
pnpm --filter @bali-hub-pos/mobile build:diagnostics
pnpm --filter @bali-hub-pos/mobile exec cap sync android
. ./scripts/android-env.ps1
& ./apps/mobile/android/gradlew.bat -p apps/mobile/android assembleDebug
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

1. Open Bali Hub POS. Confirm that the database connects and the Android development DB check appears.
2. Tap **Run adapter checks**. Expect five passed checks. These use disposable databases and verify values/nulls, commit, middle-statement rollback, migrations/idempotence/failure, and fixture read-back.
3. Tap **Create fixture**. Expect one product, one variant, and `Fixture Variant`.
4. Force-stop the app and reopen it. Before creating anything again, confirm the same saved IDs, counts and name. Refresh and repeat creation; counts must remain one each.
5. Record the phone/Android version and results in `BUILD_STATUS.md`. Keep native failures open until reproduced and fixed.

## Limits and handoff

Phase 3 features, auth, sync, deployment, printing, camera integration, signed installers and release acceptance were not built. The Windows smoke artifact is unsigned. No claim is made about clean-machine installation or update behavior. Native builds emit existing dependency/compiler warnings; the checked builds complete successfully.

Phase 2 awaits independent review and a rerun of the corrected Android adapter checks. Fixture creation and restart persistence passed according to the user. Existing generated desktop artifacts and the unrelated `memory/` folder are excluded from the source commit.

## Phone test correction

The first native run reached the failed-migration scenario, but its same-line SQL caused the Android plugin to execute only the CREATE TABLE and skip the intended failing INSERT. The shared test now uses semicolon + newline separators, matching the shipped migrations, and errors identify the failed scenario. No production migration, adapter, or SPEC change was needed. Lint/typecheck, all 43 tests, and all five Electron scenarios passed again. The diagnostic APK was rebuilt, installed with existing data preserved, and reopened on the connected phone. Native rerun remains pending.
