# VaporFlow — Supabase Setup and Deployment Guide

Version 2.0 · Phase 8B Companion

## 1. Safety & Architecture Rules
- **Never replay initial CREATE TABLE migrations (`00001_initial.sql`) over a deployed production database.** Use Supabase migrations or schema evolution for incremental changes.
- **Never expose `service_role` keys** in client applications (`@vaporflow/app`, Electron, Capacitor) or repository secrets. Only use `anon` / public keys.
- Tenant isolation is enforced at the database level via RLS policies (`member_read`), check constraints (`shop_id = id`), immutable ledger triggers (`prevent_ledger_change()`), and secure RPC functions (`claim_shop`, `sync_push`, `sync_pull`).

## 2. Project Setup Steps
1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. Obtain your Project URL and Anon/Public API Key from Project Settings > API.
3. Configure your local `.env` file (copied from `.env.example`):
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Apply the initial schema migration (`supabase/migrations/00001_initial.sql`) using the Supabase CLI (`supabase db push`) or SQL Editor in the Supabase Dashboard.
5. Configure Authentication providers:
   - Enable Email/Password authentication in Supabase Auth settings.
   - Configure email confirmation settings according to your deployment policy. (VaporFlow handles pending confirmation states gracefully by informing the user if confirmation is required before signing in).

## 3. Cloud Enrollment & Sync Workflow
- **Sign Up / Sign In**: Users sign up with email and password via the Cloud & Sync settings panel.
- **Claim Shop (First Device)**: When initializing a shop locally, the device generates a unique device code and shop ID (UUID v7 with `7` at position 15). Connecting to cloud calls `claim_shop(shop_id)`, creates the shop record and owner membership, and pushes existing local data.
- **Join Existing Shop (Second Device)**: On a fresh device, entering the shop ID / device code performs a full pull of all synced tables and configures the receipt counter using the Phase 5 next/last-used convention.
- **Offline Resilience**: VaporFlow is local-first. SQLite remains fully functional offline. When network connectivity is restored or manual "Sync Now" is triggered, the sync engine pushes pending dirty rows and pulls updates.
