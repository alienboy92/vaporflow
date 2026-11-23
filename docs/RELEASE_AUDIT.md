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

## Final gate • 23 November 2026

**Hold the release.** The ordinary shop workflow and both compilation targets passed. Remaining sync risks can leave one device with incomplete history or a stale price even if other transactions succeed. No live shop, hosted schema, signing material or installed customer app was modified.

| Severity | Fixed | Not fixed / needs owner decision |
|---|---|---|
| BLOCKER | — | S1 clock-based lost edits, S2 commit-order gap, S4 rejected pull rows, R3 deployed two-device acceptance, R5 vulnerable runtime/toolchain |
| HIGH | D1 PKT accounting, C1 invalid acknowledgements/keys, P1 product prices | S3 protocol negotiation, S5 interrupted enrollment, D2 Android backup verification, B1 hardware acceptance, R2 signed updates |
| MEDIUM | U1 version drift, U2 transient update errors, I1 render boundary and devtools, P2 large-list rendering | R4 distribution terms, P3 full inventory latency |
| LOW | R1 ignores, R6 renderer artifacts, I2 timer leak | I2 complete motion and accessibility acceptance |

### Additional findings and disposition

| ID | Severity | Location at audit | What can happen and action |
|---|---|---|---|
| S4 | BLOCKER | packages/core/src/sync/engine.ts:392 | A schema-invalid incoming row is held in an in-memory problems list. The page cursor may advance past it and a restart forgets the problem. NEEDS OWNER DECISION. Recommend a durable per-shop/table/row rejection record written in the same transaction as the cursor, with replay on upgrade and visible unresolved status. Alternative: stop that table at the first invalid page and keep other tables progressing where dependencies permit. Test restart and replay beyond the overlap. |
| S5 | HIGH | packages/core/src/sync/enrollment.ts:90 and :155, packages/app/src/context/CloudSyncProvider.tsx:296 | The empty-shop guard can reject a retry after the shop page was committed but enrollment had not finished. Recommend a durable enrollment marker before first pull, resume only the matching account/project/shop/device, then clear it atomically with completion. Alternative: provision a separate new scratch profile and retry. Do not clear an existing shop. NEEDS OWNER DECISION on the enrollment recovery protocol. |
| C1 | HIGH | packages/core/src/sync/supabase-transport.ts:26, packages/app/src/context/CloudSyncProvider.tsx:175 | Unexpected success payloads formerly acknowledged uploads or looked like empty pulls. Client now requires the full count and validates page shape. It rejects privileged or malformed keys before saving configuration, saves URL/key atomically and checks sign-out errors. Manual sync reports an offline/pending result. S3 remains open for semantically incompatible servers. |
| P1 | HIGH | packages/app/src/screens/ProductsScreen.tsx:270, :410 | Both prices defaulted to zero. parseInt could truncate an entered price. Blank prices now require an explicit safe whole-rupee amount. Explicit zero remains valid. |
| R5 | BLOCKER | apps/desktop/package.json:25, package.json:18, pnpm-lock.yaml | Registry audit originally returned 4 critical, 25 high, 46 moderate and 10 low advisories. Patched builder-util-runtime 9.2.10 to 9.7.0 and repeated unpacked packaging. Remaining: **4 critical, 24 high, 46 moderate, 10 low**. Critical findings include tar, tinypool and Vitest in tooling. High findings also affect Electron 33, the shipped Windows runtime. Other affected families are Vite, esbuild, extract-zip, app-builder-lib, react-router, glob, minimatch and @vitest/mocker. The app uses a public, token-free update check. That limits exposure to the builder redirect issue only. NEEDS OWNER DECISION: approve a supported Electron/toolchain major upgrade with native ABI, update and installer qualification. Recommend delaying distribution until the new runtime and packaging chain pass. Re-run pnpm audit --json for current dependency paths and patched versions. |
| P2 | MEDIUM | packages/app/src/screens/ProductsScreen.tsx:603, StockScreen.tsx:372, SalesScreen.tsx:379 | Large lists mounted every item. The three primary lists now window records above 200 with overscan and measured row heights. Full data loading and some secondary selectors still scale with the complete shop. |
| P3 | MEDIUM | packages/core/src/repositories/stock.ts:62, packages/core/src/repositories/report.ts:215 | Loading 10,000 inventory rows took 118 ms. Annual report suite took 508 ms. Measure indexed, paged repository reads on the target hardware before changing stock storage. No new schema/index was deployed. |
| R6 | LOW | packages/app/tsconfig.json:23, apps/mobile/package.json:7 | Compiler output could reintroduce maps/test JS into the renderer directory. TypeScript now writes to dist-types and the mobile build generates its own clean Vite distribution. Removed unused sql.js and @types/sql.js. |
| I2 | LOW | packages/app/src/index.css:188, packages/app/src/components/Toast.tsx:33 | Fixed the timer leak, route/sheet/toast entrance motion, button press and the rapid quantity highlight. Reduced-motion users skip these effects. Full exit motion, cart removal, all touch targets, focus trapping and contrast in shop lighting remain NOT VERIFIED or incomplete. |

### Verified on this checkout

- Frozen lockfile install in a new dependency-free Git clone passed. Lint and strict typecheck passed. Root test suite: **193 passed, 8 skipped**. Six require hosted Supabase credentials. Both opt-in benchmark tests were run separately and passed. An initial suite run used a previously installed Electron ABI SQLite binary in the Node test tree. Rebuilding the core test binding resolved it. No business assertion was bypassed. React Router printed future-flag warnings and Vite warned about a roughly 1.2 MB main JS chunk.
- Electron/Vite production renderer and Windows x64 unpacked build passed. Packaged smoke used a new user-data directory, migrated, rolled back a deliberately failed batch and verified persistence on the next process launch. Native Electron contract tested schema 001 → latest, retained a seeded record, reopened the original pre-upgrade SQLite snapshot and refused a downgrade. The normal DB is Electron userData/vaporflow.sqlite. Android renderer, Capacitor asset copy, release resource merge and Java compilation passed. ADB listed no attached device. APK signing, install and uninstall were outside this run.
- An isolated Electron renderer used the production preload and real SQLite adapter with external requests blocked. It created a shop with address and phone, added a product (cost 40, selling price 100, opening stock 5), scanned three units, and completed cash receipt PC1-000001 for PKR 300. Reload retained the shop, stock showed 2, and Today showed PKR 120 COGS and PKR 180 profit. The calendar accepted a custom start date. Reports had no document-width overflow at 1280×800, 360×640 and 640×360 in Chromium. These are renderer results; Android OTG, WebView, printer, all routes and physical readability require the checks below.
- Integer money uses safe-integer checks and BigInt intermediates. Checkout writes the price/cost snapshot, sale, lines, movements and counter in one SQLite batch. A regression sold two units at 23:30 PKT, changed the product prices, soft-deleted the product and verified the receipt and original day's P&L. Midnight PKT is 19:00 UTC on the preceding date. Sale over available stock is permitted with a warning. An empty cart, negative/zero sale quantity and duplicate live barcodes are rejected. Null barcode is supported. Sales are immutable; correction is a return, with optional restock. Disconnected returns against the same line can exceed the quantity sold; reconcile the warning operationally as specified in SPEC §8.
- Scratch in-memory SQLite on Windows, Node 24.17, 10,000 products and variants, 50,000 sales, 100,000 movements. One measured sample: cached product-name filter **0.82 ms**, indexed barcode lookup **2.17 ms**, atomic checkout **3.33 ms**, stock list **117.53 ms**, annual P&L plus chart and top lists **508.29 ms**. These are repository/filter timings. Android I/O and scan-to-paint latency are NOT VERIFIED.
- Dirty flags on SQLite rows form the durable pending queue. Ledger IDs are device-generated UUID v7; stock is the sum of movements. SQLite/fake-transport tests passed for two offline sales, retries, duplicate delivery, interrupted pages, tombstones, overlap, fresh pulls and edits during push. Local PostgreSQL tests executed the setup migration and exercised membership, direct access denial, cross-shop references, immutable ledger, atomic RPC rollback and cursor paging. These tests do not close S1–S5 or attest the live project's policies.
- Gitleaks 8.30.1 scanned 109 commits across available refs and reflogs. All three historical matches were the same local rollback-test settings name, confirmed by matching the test INSERT to its lookup in the source and two compiled copies. Zero credential findings in the scanned renderer, Android staging, Electron build and unpacked resources. A separate signature and sensitive-filename scan covered 618 distinct historical blobs at the baseline. No confirmed credentials requiring rotation. Scanners cannot attest arbitrary unlabelled passwords or unreachable/deleted remote history. Only example key/config filenames were tracked.
- No tracked legacy spelling found. Git object packs were 1.33 MiB with 1.85 MiB loose at baseline. Largest current tracked file is the lockfile, about 253 KB. Largest observed historical blob was a 1.46 MB JS map. Local production dependency manifest inventory contained MIT, BSD, Apache, ISC, BlueOak, Unlicense and dual-license options. Native redistribution notices and distribution terms still require owner review. The support logger redacts arbitrary messages and retains up to 100 entries in memory; export from Settings before closing the app.
- **Files deleted:** none. Historical migrations and business tests remain necessary. Four pre-existing logo PNGs remain in place, locally excluded from Git status at the owner's request. The pre-existing Android signing-script hook was needed for a fresh clone and was included in the versioning commit. No release installer, new keep-alive or cloud deployment was created.

### Supabase setup, isolation and capacity

Run [00001_initial.sql](../supabase/migrations/00001_initial.sql) once on a **new, empty** Supabase project via SQL Editor. This is the complete setup file used by the local integration tests. Use [the setup guide](SUPABASE_SETUP.md) for Auth, project URL, owner enrollment and second-device setup. One installation opens one local shop. Cloud shop_id, membership, tenant foreign keys and RPC checks permit separate shops to share a project. Deployed schema parity is **NOT VERIFIED**. Compare the live schema dump with the committed SQL, including function definitions and grants. Run the following in SQL Editor. Expect 12 application base tables, each with RLS true and a read policy. Review additional exposed tables independently.

```sql
select c.relname as relation, c.relrowsecurity as rls,
       p.policyname, p.roles, p.cmd, p.qual, p.with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relkind in ('r','p')
order by c.relname, p.policyname;

select pg_size_pretty(pg_database_size(current_database())) as database_size;
```

On a disposable project run the live test in packages/core/src/sync/supabase-live.test.ts with LIVE_SUPABASE_URL, LIVE_SUPABASE_ANON_KEY, LIVE_TEST_EMAIL and LIVE_TEST_PASSWORD supplied through the test environment. Provision a second confirmed test account for isolation and set LIVE_TEST_EMAIL_2 and LIVE_TEST_PASSWORD_2 where supported by the test. Do not use real shop credentials. With only the public key, verify table/RPC access is denied. Signed in as the second shop, query the first shop's ID and verify zero rows or denial. Verify owner reads succeed on the same data. Save the counts, status codes and tested migration revision.

Free projects can pause after about a week of inactivity. While paused, local checkout continues; pending writes retry with backoff and the badge should surface the failure. In Dashboard, open the organization, select the paused project, choose **Resume project**, confirm, wait for service health and use **Sync now**. Observe both devices converge before declaring recovery. The platform documents a one-year resume window. Daily backups are a paid feature; export a versioned .vfbackup from Settings to separate storage and periodically restore into a disposable profile. A synthetic keep-alive was not added. [Project pausing](https://supabase.com/docs/guides/platform/project-pausing) · [Backups](https://supabase.com/docs/guides/platform/backups)

Free allowances include a 500 MB database, 1 GB file storage and 5 GB egress. Capacity is byte-based. Illustrative assumption: 100 receipts/day × 4 KB per receipt including lines, movements and indexes ≈ 0.4 MB/day, or about 1,250 days before other tables, indexes, bloat and existing usage. This is **not measured hosted growth**. Record pg_database_size each week, estimate remaining days from actual growth and monitor egress during first pulls. Logo data stored in table rows consumes database capacity. [Supabase pricing](https://supabase.com/pricing)

### How an update reaches the user

1. Online at startup, every six hours while open, or on Settings → Check for updates, the app requests GitHub's public latest-release API without a token. The configured repository returned HTTP 200 anonymously; releases/latest returned **404**. A production release was unavailable for a real download. Offline skips the automatic request; malformed replies and HTTP failures are handled. Unauthenticated clients normally share 60 requests/hour per originating IP. [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
2. A newer stable version produces a dismissible banner. Checkout stays available. Settings shows notes and the matching asset digest when GitHub supplies SHA-256. One Windows .exe and one Android .apk per release avoids ambiguous selection. If an asset is missing, the release page opens. Downloads go to the system browser. Compare the downloaded file against the published SHA-256 before opening it.
3. **Windows:** finish the sale, export a backup, exit the old app, run the installer over the existing version and reopen. The installer is unsigned; Windows SmartScreen may show an unknown-publisher warning. The owner may accept that distribution experience after verifying the artifact or obtain an Authenticode signing certificate and sign later. Test upgrade and uninstall/reinstall separately in a disposable Windows account.
4. **Android:** finish the sale, export a backup and open the downloaded APK. If prompted, open Settings → Install unknown apps for that browser/files app, allow it, return to the installer and choose Update. Revoke the permission afterwards. Keep applicationId com.vaporflow.pos, sign with the original release key, and use a higher versionCode. Never solve a signature mismatch by uninstalling a device containing the only copy of shop data. Reopen and verify data and version.

### Owner release checklist and NOT VERIFIED acceptance

1. Resolve S1–S5, R5 and the live sync gate. Approve terms/notices, choose the permanent signing key and back up the keystore, alias and passwords in two access-controlled locations. Verify recovery by signing a disposable update. Keep private signing files outside Git. Configure the actual production Supabase project and test isolation as above.
2. On test PC and phone initialize one shop and use distinct device codes. Seed stock 10, synchronize, disconnect both. Sell 2 cash on the PC and 3 online on the phone. Kill and restart both while offline. Reconnect the PC, interrupt the phone during sync, retry twice. Expect stock **5**, exactly two receipts with different IDs/numbers, matching sales, payments and P&L on both devices, and no pending rows. Add a fresh test profile and verify the same results. Repeat with coincident price edits, a soft delete, an expired session, offline logout, rate limiting, a duplicate barcode, an interrupted first pull after the shop row and incompatible server schema. Capture counts, status, conflict resolution and retention of pending changes.
3. On the Media Link scanner verify keyboard mode, **F13 prefix + Enter suffix** on Windows and via Android OTG if supported. Scan 00001234 three times with the scan box, another text field, no field, and a button focused. Expect quantity 3 for each independent trial, no text in the other field and no unintended activation. Open receipt/delete/restore dialogs and repeat; nothing destructive should fire. Try mixed case, leading zeros, a long printable 2D payload, unknown code → create with exact prefill, a missing terminator, stray suffix, and deliberately slow manual typing. Explicitly test a product barcode field and the Stock In variant selector. A suffix-only wedge is ambiguous with a keyboard; safe capture in arbitrary fields is **NOT VERIFIED** without the prefix. If the model cannot emit F13, hold rollout and agree another supported prefix.
4. Print a cash and an online receipt with logo, address, phone, return, long item names and discounts. Verify number, PKT date/time and totals on paper, Windows PDF and Android share/save. Check stock threshold equality, return with/without restock, and reject empty/negative quantities. Check same-day and custom P&L across midnight, then edit prices and retire the sold product. Confirm the historical receipt and profit persist. Verify keyboard Tab/F2/F9/Esc, modal focus, 44 px touch targets, reduced motion, poor lighting and rotation on the actual phone. Scroll 5,000 products and scan during an active cart. Long-name clipping, all-screen accessibility, native print/share and end-to-end input latency remain **NOT VERIFIED**.
5. Export a full backup from Settings and restore it **only into a disposable profile**. Compare sales, stock, receipt counters, permissions and report totals. On Android, populate schema 001 and update in place; verify that the pre-migration snapshot exists and opens, the upgrade keeps records, and a backup-write failure prevents migration. Do not uninstall to perform the upgrade test.
6. For the 1.0.0 → 1.0.1 rehearsal, use a separate public test distribution repository configured with VITE_UPDATE_REPO. Start with signed test version 1.0.0 on each platform, local sales and a pending write. Increase apps/desktop/package.json version to 1.0.1; Android derives versionCode 2. Run the checks below, build the signed assets in the publishing session, hash each with Get-FileHash -Algorithm SHA256, publish notes and both hashes on the stable v1.0.1 release. Check the public endpoint anonymously. Exercise startup, manual, offline, downgrade, dismissal and missing-asset cases. Confirm the right file opens, the upgrade retains the shop, PIN and pending sale, and a second sync does not duplicate it. Publish to the production repo only after owner acceptance. [Release commands](UPDATES.md)

### Reproduce this gate without installers

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
$env:VAPORFLOW_BENCH = '1'
pnpm test -- packages/core/src/scale-benchmark.test.ts packages/core/src/phase6.test.ts
Remove-Item Env:VAPORFLOW_BENCH
pnpm --filter @vaporflow/desktop test:contract
pnpm --filter @vaporflow/desktop build:unpacked
pnpm --filter @vaporflow/desktop smoke
pnpm --filter @vaporflow/mobile build
pnpm --filter @vaporflow/mobile exec cap copy android
. ./scripts/android-env.ps1
./apps/mobile/android/gradlew.bat -p apps/mobile/android :app:mergeReleaseAssets :app:compileReleaseJavaWithJavac
pnpm audit --json
```

For a fresh Android checkout use cap:sync after building the mobile renderer to generate plugin build inputs before Gradle compilation. This session verified native compilation in the existing Android workspace. Git history for this audit starts after a55c74a; use `git log --reverse --oneline a55c74a..HEAD` for the complete sequence including this report.

VERDICT: NO-GO
