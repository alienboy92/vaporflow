# VaporFlow

Point-of-sale system for retail shops. Runs on Windows (Electron) and Android (Capacitor), works fully offline, syncs to Supabase when online.

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm i -g pnpm`)
- **Android Studio** with an Android SDK (for mobile builds)
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

1. Connect your phone via USB and enable USB debugging.
2. Make sure `adb devices` lists your device.
3. Run:

```bash
# First time only — create the Android project:
cd apps/mobile
npx cap add android
cd ../..

# Every time:
pnpm android:run
```

This builds the web app, syncs it into the Capacitor Android project, and launches it on the connected device.

## Other commands

| Command | Description |
|---------|-------------|
| `pnpm lint` | ESLint across all packages |
| `pnpm typecheck` | TypeScript project references build check |
| `pnpm test` | Run all vitest tests |

## Repository layout

```
packages/core      — Domain types, schemas, money math, repositories, sync engine
packages/app       — Shared React UI (Vite + Tailwind + HashRouter)
apps/desktop       — Electron shell (Windows)
apps/mobile        — Capacitor shell (Android)
supabase/migrations — Postgres schema and RLS policies
docs/              — Product specification
```
