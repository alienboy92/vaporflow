# Release sync design

## Deployment boundary

Export each device's backup, finish pending sync and stop cloud sync before cutover. The owner applies 00001_initial.sql on an empty project, followed by the new versioned-sync migration, in filename order. Existing projects already at 00001 run only the new migration. Work here uses disposable local databases. Old clients must lose permission to upload through the timestamp-based RPC at cutover. Existing SQLite databases use the native pre-upgrade snapshot before the next additive migration. Preserve immutable ledgers and their IDs.

| Finding | Planned implementation and verification |
|---|---|
| S1 | Add server row_version and a trigger assigning versions and authoritative timestamps. Replace timestamp conflict decisions with a tenant-scoped compare-and-set RPC. A dirty local row retains its known base and its local fields until acknowledged. Preserve both editions for Settings resolution. Keep mine retries against the observed remote version; keep theirs adopts exactly that edition. The stock ledger remains insert-once. Target sync/engine.ts, transport types, Supabase transport, migrations and CloudSyncProvider. Exercise clock skew, stale tombstones and lost acknowledgements. |
| S2 | Keep the existing keyset ordered by server_updated_at and UUID. Rewind ten minutes once per table per cycle. Reconcile paginated shop-scoped ID/version manifests on startup and daily; fetch missing or mismatched rows, including tombstones, in FK order. Advance reconciliation completion only after the full pass. Test late commits inside and outside the overlap, replay and interruption. |
| S4 | Add local quarantine keyed by shop, table and remote identity. Save raw payload, rejection reason, remote version and receipt time alongside page/cursor writes in one batch. Restore attention counts and details from SQLite. Retry saved payloads on upgrade and on request, deleting a quarantine record only with successful application. |
| R5 | Audit the workspace lock and distinguish native runtime dependencies from development/build tooling. Use a disposable npm lock projection for npm CLI checks if needed and disclose its limits. Query stable Electron releases, update native SQLite binding/rebuild tooling as required, then run root checks, unpacked Windows package/smoke and Android release compilation after each upgrade group. |
| Enrollment | Persist pending enrollment identity before remote calls and resume it only for the same shop, project, user and device. Record device identity and counter recovery with completion; keep partial enrollment out of the normal POS until recovered. Test failures around claim, device registration, first pull and local completion. |
| Scanner | Store optional literal prefix and suffix per device. Preserve leading zeros. Strip each matching boundary once, only in a scan context. Add a Settings diagnostic showing escaped raw characters before normalization. A configured suffix or bounded framed inactivity can finish scans without Enter. Test prefix, suffix, default and missing Enter. |
| Updates | In core/updates.ts return a successful unavailable result for latest-release HTTP 404; preserve errors for other HTTP failures. Verify Settings/banner semantics and checkout independence. |
| Printing | Trace the desktop HTML/iframe print dialog, Android plugin WebView/PrintManager and PDF/share paths. Require physical 80 mm and A4 label alignment, real-device save/cancellation and repeated print acceptance on each platform. |

Each implementation starts with a regression that fails against the baseline. Deployment and physical acceptance remain separate release gates.

## Implementation and cutover

1. On a new, empty project run `supabase/migrations/00001_initial.sql` once. On an existing project confirm this baseline is already applied.
2. With old clients disconnected, run `supabase/migrations/20261123041900_versioned_sync.sql` once as the migration owner. It commits the triggers, version column, scoped RPC grants and legacy upload revocation together. Existing rows start at revision 1. No remote SQL was applied in this session.
3. Start the updated clients. Their bundled SQLite runner applies `packages/core/migrations/004_sync_versions.sql` after 001–003. It adds the revision and attention tables. A device whose existing edit has no known base uses 0. Differing existing cloud data requires explicit owner resolution. A successful Windows upgrade snapshot was reopened in the native contract test.
4. In a disposable shop follow the two-device, Android backup and physical acceptance tests in RELEASE_AUDIT.md. Preserve the original database snapshots and exports until counts, movements, receipts, pending writes and conflicts have been checked.

The shipped SyncEngine requires versioned replication. Historical timestamp fixtures are isolated from its execution path. Enrollment stores account/project identity before the owner claim and before the joining device starts its pull. Repeated claims use the same shop UUID. Receipt counter recovery can repeat before the final atomic enrollment marker. Scanner diagnostics and delimiters are local to each device. Electron uses its bundled node:sqlite implementation for WAL transactions and consistent backups.
