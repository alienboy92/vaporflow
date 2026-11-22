# VaporFlow release audit

## Phase A • read-only findings

Baseline a55c74a on main. The checkout already contained an Android Gradle edit and four untracked logo PNGs. The release review excludes these from its commits. Shared React/Vite renderer, Electron/better-sqlite3 on Windows, Capacitor/native SQLite on Android, pnpm workspace and Supabase Auth/Postgres RPC replication. Build.md is absent. No installer is authorized.

| ID | Severity | Initial status | Evidence | Finding and proposed fix |
|---|---|---|---|---|
| S1 | BLOCKER | needs owner decision | supabase/migrations/00001_initial.sql:364, SPEC §7.9 | Mutable rows use the device clock. A later price change or deletion from a slow clock can lose. Recommend a base server revision per edit, compare-and-set on push, durable conflict copies and explicit resolution. Alternatively retain documented LWW and accept lost edits. |
| S2 | BLOCKER | needs owner decision | packages/core/src/sync/engine.ts, SPEC §7.3 | A five-second replay window cannot guarantee delivery of a long-running transaction with an earlier trigger timestamp. Recommend a commit-ordered change feed or durable periodic reconciliation by row identity/version. Keep idempotent ledger writes. |
| S3 | HIGH | needs owner decision | packages/core/src/sync/supabase-transport.ts:1 | Missing negotiated client/server protocol version. Introduce an additive capabilities RPC and reject incompatible sync before push, with an update prompt and local checkout available. Coordinate rollout with S1/S2. |
| D1 | HIGH | not fixed | packages/core/src/dates.ts:2, packages/app/src/screens/ReportsScreen.tsx:59 | Report days, presets and displayed timestamps depend on host timezone. Apply PKT consistently and check both sides of midnight. |
| D2 | HIGH | not fixed | packages/core/src/migrations/runner.ts:29 | Journal tracks applied scripts but lacks downgrade rejection and a verified automatic pre-migration snapshot across platforms. Add fail-closed journal validation and native consistent snapshots. |
| B1 | HIGH | not fixed | packages/app/src/utils/wedge.ts:2 | Focus-based wedge entry cannot distinguish arbitrary scanner input in another field before characters arrive. Recommend configuring a distinct scanner prefix for capture and retaining intentional manual entry. Verify actual scanner configuration before deployment. |
| U1 | MEDIUM | not fixed | packages/core/src/version.ts:2, apps/mobile/release-signing.gradle:8, apps/desktop/package.json:5 | Independent native and JS version literals can drift. Derive release metadata from a shared source and gate code progression. |
| U2 | MEDIUM | not fixed | packages/app/src/context/UpdateProvider.tsx:104 | An automatic fetch can clear an existing update banner after transient failure. Preserve last successful result. |
| I1 | MEDIUM | not fixed | packages/app/src/main.tsx:9, apps/desktop/src/main.ts:39 | Root render lacks recovery boundary and packaged Electron permits developer tools. Add recovery UI and disable packaged devtools. |
| I2 | LOW | not fixed | packages/app/src/components/Toast.tsx:33, packages/app/src/index.css:188 | Toast timer IDs accumulate and motion is incomplete. Release completed timers and add reduced-motion-aware transitions. |
| R1 | LOW | not fixed | .gitignore:37 | Missing common SQLite, log and Windows junk exclusions. Add patterns. |
| R2 | HIGH | not fixed | docs/UPDATES.md:1 | Public release visibility, published asset provenance, signed upgrade and preservation on both platforms require live evidence. Publish to a public distribution repo if source is private. |
| R3 | BLOCKER | not fixed | packages/core/src/sync/supabase-live.test.ts:1 | Actual authenticated two-device offline/restart/retry and deployed policy behavior require independent acceptance evidence before go-live. |
| R4 | MEDIUM | needs owner decision | package.json:1 | No root license found. Owner must establish distribution terms and approve third-party notices before distribution. |

## NEEDS OWNER DECISION

S1, S2 and S3 require a coordinated cloud protocol decision. Do not roll out either half independently. R4 requires the rights holder. For B1 choose a scanner prefix supported by the actual device and verify the same keyboard events reach both operating systems.
