# Windows cloud setup SQL verification

**VERIFIED** on November 27, 2026. The Windows build generates and bundles setup.sql. In Settings → Cloud Connection and the join-shop wizard, Windows users can copy the SQL and open the Supabase dashboard. The cloud provider checks schema version 4 before starting or resuming sync. Incompatible or missing versions block cloud work and show a persistent warning. Local shop operations remain available offline.

## Discovery and migration order

Electron and electron-builder build the Windows NSIS installer from `apps/desktop/package.json`. The existing wizard and Settings accept the project URL, public key, email and password at runtime. Local settings hold the URL and public key. Supabase Auth persists the session in its existing browser storage. The password is used for authentication. Settings already contains the cloud connection and status controls.

Apply the files under `supabase/migrations` in this order:

1. `00001_initial.sql`
2. `20261123041900_versioned_sync.sql`
3. `20261123042000_cloud_probe.sql`
4. `20261127111953_app_meta.sql`

**Existing projects must run only unapplied sections.** The historical migrations create tables, policies and functions unconditionally. Running the entire bundle again on an initialized database can fail before it reaches the new migration. A project already at the third migration needs only the fourth. The new migration can be repeated. Ordering uses an explicit manifest because timestamp IDs have natural gaps. Both the generated header and the client derive their version from the manifest length.

## Files changed

- Generator and migration: `.gitignore`, `scripts/build-setup-sql.js`, `packages/core/src/cloud-migrations.ts`, `supabase/migrations/20261127111953_app_meta.sql`.
- Desktop packaging and runtime: `apps/desktop/package.json`, `apps/desktop/scripts/electron-build.js`, and `apps/desktop/src/{setup-sql,main,preload,ipc-policy}.ts`.
- Platform bridge, schema reader and tests: `packages/core/src/adapters/bridge.ts`, `packages/core/src/{index,cloud-schema,cloud-schema.test}.ts`.
- User interface and sync startup: `packages/app/src/components/CloudSetupSql.tsx`, `packages/app/src/context/{CloudSyncProvider,DbProvider}.tsx`, and `packages/app/src/screens/{SettingsScreen,SetupWizard}.tsx`.
- Verification report: `docs/SETUP_SQL_REPORT.md`.

## Run and verify

| Check | Result |
|---|---|
| `pnpm lint` and `pnpm typecheck` | Both passed |
| `pnpm test` | 231 passed, 8 skipped, 0 failed |
| Disposable PGlite PostgreSQL database | The full generated script ran with stand-ins for Supabase Auth roles and objects. Authenticated SELECT returned version 4. Anonymous SELECT and authenticated UPDATE privileges were false. |
| `pnpm --filter @bali-hub-pos/desktop build:unpacked` and `smoke` | Both passed |
| NSIS with `--prepackaged out/win-unpacked --publish never` | Verification installer built in the system temporary directory |
| Packaged resource inspection | `apps/desktop/out/win-unpacked/resources/setup.sql` and `dist-sql/setup.sql` had identical SHA-256 `14AE805842B2ADCAB967EBCD5A30989A3016D2ADB68B977A354983E01EFF2E49` |

Run `pnpm dev:desktop` and open Settings → Cloud Connection. Select **Copy setup SQL**, then **Open Supabase**. A fresh project can run the whole script once. Android receives the schema compatibility check and uses its existing cloud configuration interface.

The Docker daemon was unavailable. Hosted Supabase, a live multi-device sync, and an interactive clipboard round trip remain unverified. The local build includes the three pre-existing desktop working-tree edits, which were excluded from the task commits. This task added no project dependencies, kept version 1.0.2, and published no release.
