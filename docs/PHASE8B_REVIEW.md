# VaporFlow — Phase 8B review

Updated 17 November 2026. Scope: Auth, cloud enrollment, and Supabase integration. Implementation commit `f3363e5`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` and `docs/BUILD_PROMPTS.md` are unchanged.

## What was built (as reviewed)

- Supabase client wrapper (`packages/core/src/sync/supabase-client.ts`): `createVaporFlowSupabaseClient` (persistent session, auto token refresh) and `claimShop` over the `claim_shop` RPC.
- Transport (`packages/core/src/sync/supabase-transport.ts`): `SupabaseSyncTransport` mapping `sync_push`/`sync_pull` RPC args exactly, with table/limit/cursor validation and RPC-error propagation.
- Settings UI cloud panel and `.env.example` + `docs/SUPABASE_SETUP.md`.

## Review verdict: BLOCKED (8 findings) — all repaired

Independent review of `f3363e5` found the transport boundary thin and correct, but the phase's own acceptance unimplementable as built:

1. **HIGH — the sync engine never ran in the app**: no `engine.start()` and no `saleCompleted()` anywhere in app code; sync only happened on button clicks, and failed manual syncs leaked orphaned engines with backoff timers. **Fixed**: `CloudSyncProvider` (see below) starts the engine on connect and restore; `saleCompleted()` is wired into `SaleScreen` after `completeSale` (2 s debounce, no-op when cloud is not connected).
2. **HIGH — new SupabaseClient + engine per button click**: three creation sites (claim, Sync Now, sign-out) broke `autoRefreshToken` (access tokens expire ~1 h) and orphaned running engines. **Fixed**: one app-lifetime `CloudSyncProvider` owns exactly ONE client and at most ONE engine; `saveConfig`/sign-out stop the old engine before replacement; unmount cleanup stops timers.
3. **HIGH — second-device enrollment missing entirely**: `docs/SUPABASE_SETUP.md` §3 documented a join flow that did not exist. **Fixed**: `packages/core/src/sync/enrollment.ts` + first-run wizard "Join an existing shop" tab — empty-device guard, read-only shop probe BEFORE `claim_shop` (claim silently INSERTs a placeholder shop for unknown IDs), membership claim, random device code unique against CLOUD device codes (3–4 chars over an unambiguous A–Z0–9 alphabet), full pull with null cursors, receipt-counter recovery (max receipt number across ALL sales; the counter stores the LAST-USED value, so the next sale is value+1), and the generated device code shown on screen after joining.
4. **MEDIUM — session/enrollment not restored on app start**: `authUserEmail` was component state, credentials fell back to garbage placeholders, no persisted "connected" marker. **Fixed**: the provider reads `supabase_url`/`supabase_anon_key`/`cloud_enrolled_shop_id` from settings, calls `auth.getSession()`, and auto-starts the engine for an enrolled device with a live session (interrupted-enrollment recovery).
5. **MEDIUM — trivial arg-capture mocks**: the only supabase tests asserted RPC args. **Fixed**: added error-path tests — RPC errors throw for push/pull/claim, pull of non-array data returns `[]`, claim returns `false` on no-membership, invalid table/limit/oversized-batch arguments reject before any RPC call.
6. **LOW — click-only status**: the badge updated only on manual actions. **Fixed**: provider polls `getStatus()` every 5 s while an engine runs.
7. **LOW — credential validation + hardcoded version**: save-time validation (https URL, placeholder key rejection) with a clear error; "Version: 1.0.0 (Phase 8B)" replaced with an honest development-build label.
8. **LOW — doc/status overclaims**: BUILD_STATUS and `SUPABASE_SETUP.md` §2–3 rewritten to match the actual flows (probe-before-claim, empty-device-only join, counter last-used semantics, trigger set, 5 s status polling).

Additional repairs found while applying the fixes: `enrollExistingShop` originally checked device-code uniqueness against the LOCAL devices table — empty on a join device, so it could not see cloud codes; uniqueness is now judged against a cloud `devices` pull. An explicit offline guard was added (`syncNow` no-ops silently offline, which would otherwise "enroll" with nothing pulled).

## Verified correct (no change needed)

- `SupabaseSyncTransport` arg mapping matches the real RPC signatures (`p_table`, `p_rows`, `p_shop_id`, `p_cursor_updated_at`, `p_cursor_id`, `p_limit`) and validates like the fake server.
- The 8A engine, wire conversion, batch-atomic rejection, and backoff are reused unchanged; the 19 existing sync tests still pass.
- Security posture: anon key only, no service_role, schema-replay warning preserved.

## Verification (run during the repair)

| Check | Result |
| ------------------------------------------------- | ------------------------------------------------------- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 152 tests across 24 files (was 138; +8 transport error-path tests, +6 second-device enrollment tests against two real SQLite databases), plus 2 skipped opt-in benchmarks |
| `pnpm --filter @vaporflow/app build` | PASS — 8.8 s |

Enrollment tests cover: probe exists/absent (read-only — no placeholder row created), full enrollment (unique code ≠ owner's, device row pushed with `dirty` cleared, `active_device_id` set, shop/catalog/sales pulled, stock converged, counter = '2'), non-empty-device rejection, offline rejection, interrupted-retry device reuse (same id and code, no duplicate rows), and repeat-enrollment code uniqueness against accumulated cloud devices.

## Remaining acceptance (hardware/live)

NOT RUN and pending live deployment authorization by design:

- Real hosted Supabase Auth (sign-up/sign-in/email confirmation, session persistence across restarts, token refresh past 1 h).
- `claim_shop`/`sync_push`/`sync_pull` against the hosted Postgres RPCs (the PGlite coverage of the SQL remains local).
- Real second-device enrollment over the network (Windows + phone), including enrollment retries against the hosted server and kill/restart during the initial full pull.
- Two-account authorization denial (a non-member account must not claim or join).
- Multi-connection claim contention (two accounts claiming simultaneously).
- Airplane-mode convergence on two real devices (sell offline on both, reconnect, totals match within a minute).
- Session expiry / refresh-token rotation while the engine is running.

The Phase 2–7 device checks also remain pending.

## Known issues / notes

- **Cross-device conflicts are surfaced, not auto-resolved** (carried from 8A): duplicate-barcode collisions and receipt-counter races keep the losing rows dirty and surface via `problems`/`lastError` for manual reconciliation.
- The join flow requires the owner to manually share the Shop ID (copy button in Settings → Cloud Connection) and the Supabase project credentials; there is no QR/pairing channel yet (not specified).
- Credential entry is per-device by design (local-only settings table); `.env` values are no longer read into the Settings UI — the persisted settings win, keeping behavior identical across desktop and Android.
- `probeShopExists` issues a read-only `shops` pull and trusts RLS tenant visibility; a shop that exists but is invisible to the signed-out caller reads as absent, which is the correct rejection path for a typo'd ID.
