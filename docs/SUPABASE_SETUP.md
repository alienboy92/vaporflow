# VaporFlow — Supabase Setup and Deployment Guide

Version 2.0 · Phase 8B Companion

## 1. Safety & Architecture Rules
- **Never replay initial CREATE TABLE migrations (`00001_initial.sql`) over a deployed production database.** Use Supabase migrations or schema evolution for incremental changes.
- **Never expose `service_role` keys** in client applications (`@vaporflow/app`, Electron, Capacitor) or repository secrets. Only use `anon` / public keys.
- Tenant isolation is enforced at the database level via RLS policies (`member_read`), check constraints (`shop_id = id`), immutable ledger triggers (`prevent_ledger_change()`), and secure RPC functions (`claim_shop`, `sync_push`, `sync_pull`).

## 2. Project Setup Steps
1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. Obtain your Project URL and Anon/Public API Key from Project Settings > API.
3. Enter the URL and anon key in the app (Settings → Cloud Connection & Sync, or the first-run wizard's "Join an existing shop" tab) — they are validated and stored in local settings. A `.env` file (copied from `.env.example`) is optional for development builds:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Apply the initial schema migration (`supabase/migrations/00001_initial.sql`) using the Supabase CLI (`supabase db push`) or SQL Editor in the Supabase Dashboard.
5. Configure Authentication providers:
   - Enable Email/Password authentication in Supabase Auth settings.
   - Configure email confirmation settings according to your deployment policy. (VaporFlow handles pending confirmation states gracefully by informing the user if confirmation is required before signing in).

## 3. Cloud Enrollment & Sync Workflow
- **Sign Up / Sign In**: Users sign up or sign in with email and password via the Cloud & Sync settings panel. Sign-up that requires email confirmation returns a clear "check your email" state instead of a silent failure.
- **Claim Shop (First Device)**: After the local shop exists and the account is signed in, "Connect Cloud & Claim Shop" calls `claim_shop(shop_id)`, which creates the shop record and owner membership server-side, then starts the sync engine (app-start, network-return, 30-second interval, and 2-second post-sale triggers) and pushes existing local data. The Shop ID is shown with a copy button — share it with second devices.
- **Join Existing Shop (Second Device, empty device only)**: In the first-run wizard's "Join an existing shop" tab (or after a reset), enter the Supabase URL + anon key, your cloud account credentials, and the Shop ID from the owner device. The flow:
  1. Probe the cloud read-only to verify the shop exists (a typo'd Shop ID is rejected — `claim_shop` alone would silently create a placeholder shop).
  2. Claim membership (`claim_shop`; denied unless the account is a member).
  3. Register this device with a random device code unique across the shop's cloud devices (3–4 chars; shown on screen after joining).
  4. Pull every synced table from scratch (null cursors) via the sync engine.
  5. Recover the receipt counter to the highest receipt number in use (last-used convention: the next sale uses value + 1).
  Joining is rejected if the device already has a local shop, or while offline.
- **Offline Resilience**: VaporFlow is local-first. SQLite remains fully functional offline. The engine polls status every 5 seconds for the UI, and on network return, the 30-second interval, and 2 seconds after each sale, it pushes pending dirty rows and pulls updates. "Sync Now" forces an immediate pass.

## 4. Live acceptance suite

`packages/core/src/sync/supabase-live.test.ts` runs the hosted acceptance checks. It is **skipped unless every variable is set** — never point it at a production database; it creates disposable shops per run.

```powershell
$env:LIVE_SUPABASE_URL   = 'https://<project>.supabase.co'
$env:LIVE_SUPABASE_ANON_KEY = '<anon or sb_publishable_... key>'
$env:LIVE_TEST_EMAIL     = '<disposable account email>'
$env:LIVE_TEST_PASSWORD  = '<password>'
pnpm test supabase-live
```

Requirements: the schema from `supabase/migrations/00001_initial.sql` applied (Dashboard → SQL Editor; never replay it over a deployed database), Email/Password auth enabled, and "Confirm email" OFF for the disposable accounts. The suite covers hosted Auth, `claim_shop`, two-engine convergence through the real RPCs, full second-device enrollment over the network, concurrent claim contention, interrupted-enrollment retry, signed-out denial, and second-account authorization denial. Result as of 17 November 2026: 6/6 PASS (see `docs/PHASE8B_REVIEW.md`).
