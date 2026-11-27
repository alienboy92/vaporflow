# Bali Hub POS

Point-of-sale system for retail shops. Runs on Windows (Electron) and Android (Capacitor), works fully offline, syncs to Supabase when online.

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm i -g pnpm`)
- **Temurin JDK 17** and Android SDK (for Capacitor 6 mobile builds)
- A USB-connected Android phone with USB debugging enabled (for `android:run`)

## Install

```bash
pnpm install
```

## Desktop development

```bash
pnpm dev:desktop
```

This starts the Vite dev server and opens the Electron window with hot reload.

## Build Windows installer

```bash
pnpm build:desktop
```

The NSIS installer is output to `apps/desktop/out/`.

## Run on Android phone

Run these PowerShell commands from the repository root. Capacitor 6 / Android
Gradle Plugin 8.2.1 requires **JDK 17**, SDK Platform **34**, and Build-Tools
**34.0.0**. A separate JDK 21 installation can remain installed.

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK --exact --accept-package-agreements --accept-source-agreements
```

If Windows displays an administrator/UAC prompt for the installer, click **Yes**.
The Android scripts find JDK 17 under `Program Files/Eclipse Adoptium`, even if
the terminal still has no Java on PATH or points at JDK 21. For a nonstandard
JDK location, set `JAVA_HOME` to its JDK 17 directory. The scripts set Java for
both the Gradle launcher and daemon without changing system settings.

Install Android SDK Command-line Tools **12.0** (compatible with Java 17) using
Android Studio's SDK Manager, or these commands using Google's official archive:

```powershell
$sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$toolsZip = Join-Path $env:TEMP 'vaporflow-commandlinetools-12.zip'
$toolsStage = Join-Path $env:TEMP 'vaporflow-commandlinetools-12'
curl.exe --fail --location --output $toolsZip 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
if ($LASTEXITCODE -ne 0) { throw 'SDK tools download failed' }
if ((Get-FileHash $toolsZip -Algorithm SHA1).Hash -ne '3d2917302740f476999a091bc5558837c7a863c5') {
    throw 'SDK tools checksum mismatch'
}
Expand-Archive -LiteralPath $toolsZip -DestinationPath $toolsStage -Force
New-Item -ItemType Directory -Force "$sdk/cmdline-tools/12.0" | Out-Null
Copy-Item "$toolsStage/cmdline-tools/*" "$sdk/cmdline-tools/12.0" -Recurse -Force
```

The expected SDK location is `$env:LOCALAPPDATA/Android/Sdk`; a custom
`ANDROID_HOME` or `apps/mobile/android/local.properties` containing `sdk.dir`
is also supported. Keep local.properties uncommitted. Then install the required
packages and accept the SDK licenses:

```powershell
. ./scripts/android-env.ps1
$sdkmanager = Join-Path $env:ANDROID_HOME 'cmdline-tools/12.0/bin/sdkmanager.bat'
& $sdkmanager "--sdk_root=$env:ANDROID_HOME" --licenses
& $sdkmanager "--sdk_root=$env:ANDROID_HOME" 'platforms;android-34' 'build-tools;34.0.0' 'platform-tools'

# First time only: generate the ignored native project if it does not exist.
pnpm --filter @bali-hub-pos/mobile build
if (!(Test-Path apps/mobile/android)) {
    pnpm --filter @bali-hub-pos/mobile exec cap add android
}

# Connect/unlock the phone, enable USB debugging, and approve its USB prompt.
pnpm doctor:android
pnpm android:run -Target R9VWC0007JP
```

Use `pnpm android:run` to select a device interactively, or replace the serial
above with the one shown by `adb devices`. The doctor prints PASS/FAIL and a fix
for Java, SDK location, native project, platform, build-tools, and authorized
devices; it exits nonzero if any check fails. It uses the same environment
selection as the runner. Neither command installs prerequisites automatically.

The runner builds the shared web app, copies it into the existing mobile `dist`,
syncs Capacitor, builds the APK, installs it, and launches the app. On the phone,
confirm that **Bali Hub POS** opens to first-run setup (or the sales screen if the
shop is already configured). The debug APK is
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
Native build outputs, local.properties, and signing files must stay uncommitted.

Verified on Windows with Temurin 17.0.21, Gradle 8.2.1, Platform 34 (revision 3),
and Build-Tools 34.0.0: the debug APK built, installed, and launched on the
USB-connected phone. The doctor also passed with Java/SDK environment variables
unset and correctly rejected a nonexistent device. Initial Gradle/Maven downloads
can take a long time on a slow connection. Command-line Tools 12.0 may warn about
metadata from newer SDK packages; those warnings did not block this build.

## Other commands

| Command | Description |
|---------|-------------|
| `pnpm lint` | ESLint across all packages |
| `pnpm typecheck` | TypeScript project references build check |
| `pnpm test` | Run all vitest tests |
| `pnpm doctor:android` | Check Windows Android prerequisites and USB devices |

## Repository layout

```
packages/core      — Domain types, schemas, money math, repositories, sync engine
packages/app       — Shared React UI (Vite + Tailwind + HashRouter)
apps/desktop       — Electron shell (Windows)
apps/mobile        — Capacitor shell (Android)
supabase/migrations — Postgres schema and RLS policies
docs/              — Product specification
```

## Release signing

From the repository root, generate the Android project as described above if it is absent. For a new signing identity, choose a private directory outside the repository and create the key interactively:

    keytool -genkeypair -v -storetype JKS -keystore C:/private/Bali-Hub-POS-release.jks -alias vaporflow -keyalg RSA -keysize 3072 -validity 10000

Back up the key securely and store passwords in a password manager. Reuse the same identity for app updates. Copy the example locally, then edit the four values in the ignored copy. Use forward slashes for Windows paths and Java properties escaping for literal backslashes.

    Copy-Item apps/mobile/keystore.properties.example apps/mobile/android/keystore.properties
    notepad apps/mobile/android/keystore.properties

Build from PowerShell and verify the APK signature and certificate fingerprint against the expected signing identity:

    pnpm --filter @bali-hub-pos/mobile build
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android.ps1 -PrepareOnly
    pnpm --filter @bali-hub-pos/mobile exec cap sync android
    . ./scripts/android-env.ps1
    & ./apps/mobile/android/gradlew.bat -p apps/mobile/android assembleRelease
    & "$androidSdk/build-tools/34.0.0/apksigner.bat" verify --verbose --print-certs apps/mobile/android/app/build/outputs/apk/release/app-release.apk

For a debug APK, use assembleDebug instead. Debug builds do not need keystore.properties. After regenerating the native project, repeat the preparation command. In apps/mobile/release-signing.gradle, keep versionName aligned with the core product version and increase versionCode on every release.
