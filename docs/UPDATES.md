# Software Updates

Bali Hub POS checks GitHub Releases for a newer version. It never downloads or installs
anything by itself: the user is shown an update banner (and a check button in Settings)
and the matching installer/APK opens in the system browser.

## How it works

- On launch the app calls `GET https://api.github.com/repos/alienboy92/vaporflow/releases/latest`
  and compares the release tag with `APP_VERSION` (`packages/core/src/version.ts`).
- The check repeats every 6 hours while the app is open.
- `available` shows a non-blocking banner above the workspace. "Later" hides that version
  until a newer release appears.
- Settings → Software Updates shows the current version, latest version, last check time,
  release notes and manual "Check for updates" / "Download update" buttons.
- Offline or failed automatic checks are silent. A failed manual check shows an error in
  Settings.
- Only `https://github.com/...` links may be opened. The desktop app validates this again
  in the Electron main process; Android uses Capacitor's system-browser target.
- If a release has no matching asset, "Download update" opens the release page instead.

## Publishing a new version

1. Increase the stable version in `apps/desktop/package.json`. The renderer and Android consume it. Android derives a strictly increasing code for successive stable versions (1.0.0 = 1, 1.0.1 = 2).
2. Build the installers:
   ```powershell
   pnpm build:desktop        # produces apps/desktop/out/Bali Hub POS Setup <version>.exe
   pnpm --filter @bali-hub-pos/mobile build
   pnpm --filter @bali-hub-pos/mobile cap:sync
   . ./scripts/android-env.ps1
   ./apps/mobile/android/gradlew.bat -p apps/mobile/android :app:assembleRelease
   ```
3. Create a **published (not draft, not prerelease)** GitHub Release:
   - Tag: `v<version>` (for example `v1.1.0`)
   - Title: the version
   - Description: user-facing release notes (shown inside Settings)
4. Attach both assets and keep their extensions:
   - Windows: `Bali Hub POS Setup <version>.exe`
   - Android: `Bali-Hub-POS-<version>.apk`
5. Publish. The next check picks it up automatically.

`releases/latest` ignores drafts and prereleases, so publish only when the build is ready.

## Changing the repository

The default repository is `alienboy92/vaporflow`. To point at a fork or another public
repository, set `VITE_UPDATE_REPO` at build time:

```powershell
$env:VITE_UPDATE_REPO = 'owner/repo'
pnpm build:desktop
```

The repository must be public: the check is unauthenticated and rate-limited by GitHub
(60 requests per hour per IP). One check per launch plus every 6 hours is far below that.

## Platform notes

- **Windows:** the NSIS installer upgrades in place. The SQLite database lives in the
  Electron `userData` folder, not the install directory, so data survives. Migrations run
  automatically on the next launch.
- **Android:** the new APK must use the same application ID and signing key, and a higher
  `versionCode`. Users must allow installing from the browser/files app. Data survives.
