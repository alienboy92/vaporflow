# VaporFlow — Phase 8A review

Updated 16 November 2026. Scope: sync engine and simulated devices (fake transport, two-device convergence). Implementation commit `1e2fa0e`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` is unchanged.

## What was built

- Sync engine (`packages/core/src/sync/engine.ts`): dependency-ordered push of dirty rows (200/batch), pull per table ordered by `(server_updated_at, id)` with 500-row pages and a 5-second cycle-start cursor overlap, atomic `DbAdapter.batch()` application, strict-last-write-wins preservation of newer dirty local rows, ledger tables applied insert-only, per-row problems, exponential backoff on failure, and triggers for app start, network return, 30-second interval, 2-second post-sale debounce, and manual sync.
- Transport (`sync/transport.ts`): `SQLiteSyncServer`, a simulated server backed by SQLite that mirrors the real `sync_push`/`sync_pull` RPCs in `supabase/migrations/00001_initial.sql`.
- Wire conversion (`sync/convert.ts`): the PG↔local boundary layer.
- Tests: `sync.test.ts` (13 tests) and `sync-convert.test.ts` (6 tests), plus the pre-existing PGlite coverage of the real RPCs in `postgres.test.ts` (unchanged).

## Review findings and fixes

Independent review of `1e2fa0e` found ten issues; all are resolved:

1. **HIGH — no PG↔local conversion layer**: the engine validated pulled rows with the local schemas, but production rows have PG booleans (`is_active`, `track_stock`, `show_logo_on_receipt`, `restocked` as `true/false`), offset/microsecond `timestamptz` strings, and no `dirty` column — every real pull would have failed validation, and local 0/1 pushes could not cast into PG BOOLEAN columns. New `sync/convert.ts` converts in both directions: `toWire` (push: booleans→true/false, drops local-only `dirty`/`server_updated_at`), `wireToLocal` (pull: booleans→0/1, timestamps normalized to exactly-3ms UTC by truncation, injects `dirty: 0`), and `storageToWire` (the fake server's pull mirrors `to_jsonb(t)`). The engine converts before schema validation and before transport push. Unit tests feed production-shaped PGlite-style payloads (microseconds, `+00:00` offsets, `true` booleans, missing `dirty`) through the conversion and the local Zod schemas; the engine-level wire-shape tests prove pushed rows carry booleans and no `dirty`.
2. **HIGH — the fake server modeled the wrong failure mode**: it returned per-row `errors[]` while accepting siblings, but the real `sync_push` is batch-atomic — any row failure raises and rolls back the whole batch (proven by the PGlite tests). Rewritten: constraint violations (duplicate barcode, missing id/shop_id, malformed rows) throw and nothing is written; the engine catches the throw, records one actionable problem for the batch, and lets `syncNow` schedule the backoff retry. In-batch conflicts (two rows sharing a barcode) hit the storage unique index and roll back the whole transaction.
3. **HIGH — pull could wedge forever on one invalid row**: validation-rejected rows did not advance the cursor, so a full 500-row page containing a bad row would be re-fetched forever. Rejected rows now still advance the cursor (using the row's own `server_updated_at`/`id`) while staying in `problems`, so nothing is lost silently. Covered by a rollback test that re-pulls the same poisoned page on retry with an unchanged cursor.
4. **MEDIUM — dirty-clear was check-then-act across an await**: the engine re-read each row then cleared `dirty` in a later batch; an edit landing in between would lose its dirty flag. The clear is now a single conditional batch: `UPDATE … SET dirty = 0 WHERE id = ? AND dirty = 1 AND updated_at = ?` — check and write are one atomic statement per row. Proven by a test that edits a product while its push is in flight: the edit stays dirty, the follow-up sync pushes it, and the server ends with the edited version.
5. **MEDIUM — LWW tie mismatch**: the fake used `>=`; the real RPC uses strict `>`. Now strict: an equal-or-older row is acknowledged but not applied (tested at transport level for equal, older, and newer `updated_at`).
6. **MEDIUM — sync failures were invisible**: `SyncState` now carries `lastError`; `syncNow` records it on failure and clears it on success, `getStatus()` reports `error` when either `lastError` or row problems exist (a server outage no longer renders as `synced`), and a previously-problematic row is cleared from `problems` once it is successfully acknowledged.
7. **MEDIUM — missing acceptance tests**: added all the prompt's required deterministic tests using the injectable clock/timers: retry with exponential backoff (failure → 1s backoff scheduled → retry succeeds → `lastError` cleared), edits during in-flight push, failed pull page → cursor not advanced → same page re-pulled on retry, strict-LWW timestamp ties, 5-second cursor rewind verified on the second cycle, >1,200-row offline catch-up across push pages (200) and pull pages (500), overlapping `syncNow()` calls queued and completed, and soft-delete tombstone propagation to the second device with no resurrection.
8. **LOW — `stop()` leaked timers**: the pending backoff retry and queued-sync callbacks are now tracked and cancelled in `stop()`; a stopped engine no longer syncs behind the caller's back.
9. **LOW — stray builder artifact**: `PHASE_8A_IMPLEMENTATION_SUMMARY.md` deleted from the repo root.
10. **LOW — BUILD_STATUS overclaims**: corrected (push-side validation claim, test counts) and this review linked. A successful push acknowledgement also expires stale row problems.

## Verified correct (no change needed)

- Dependency-ordered push, snapshot-based dirty clearing, cursor stored with id tiebreak, page+cursor applied in one batch, ledger pulls idempotent.
- Two-device offline convergence (the core acceptance): summed stock (75) and identical sales on both devices.
- The real RPC semantics (batch rollback, LWW, pagination, tombstones, tenant security) remain covered by the PGlite tests against the actual SQL.

## Verification (run during the repair)

| Check | Result |
| ------------------------------------------------- | ------------------------------------------------------- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 134 tests across 22 files (was 119; +15 sync acceptance/conversion tests), plus 2 skipped opt-in benchmarks |
| `pnpm --filter @vaporflow/app build` | PASS — 12.7 s; main chunk 897.7 kB (247.7 kB gzip) |

## Remaining acceptance (hardware/live)

NOT RUN and deferred to Phase 8B by design: real Supabase deployment, authenticated push/pull against the hosted RPCs (two real devices), cloud enrollment/auth, and network-loss behavior on real mobile/desktop hardware. The Phase 2–7 device checks also remain pending.

## Known issues / notes

- **Cross-device conflicts are surfaced, not auto-resolved**: a duplicate-barcode collision between two devices throws, keeps the losing rows dirty, and shows up in `problems`/`lastError`; a human must fix the data (per the build prompt, no automatic resolution was specified). Same for two devices claiming the same receipt number (one global `receipt_counter` setting): ledger rows are insert-only so both sales survive, but the collision surfaces as a problem row for manual reconciliation.
- The 5-second pull overlap re-applies recently-seen rows every cycle; this is intended (it heals rows skipped while a local edit was mid-flight) but costs a bounded number of redundant upserts per cycle.
- The simulated server ignores the real RPC's `shops` placeholder rule (`created_at = '0001-01-01'` first-claim semantics); shop claiming is Phase 8B (Auth/cloud enrollment) territory and is covered by the PGlite tests for the real RPC.
