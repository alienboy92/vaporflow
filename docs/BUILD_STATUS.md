# VaporFlow — Build Status

Updated 15 November 2026. Follow version 2.0 of [BUILD_PROMPTS.md](BUILD_PROMPTS.md); the old prompt numbers are mapped there.

**Next action: paste revised Prompt 2 into the builder session.**

## Completed baseline

| Phase           | State | Evidence                                                                                                                           |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Bootstrap   | READY | Existing workspace and platform shells. README records the verified Windows Android setup and phone smoke test.                    |
| 1 — Core/schema | READY | Correction commit `40a23e8`; lint/typecheck passed; 29 tests passed including eight PostgreSQL tests. [Handoff](PHASE1_REVIEW.md). |

Phase 1 evidence is from that commit, not a claim that tests have been rerun after every later change. Supabase has not been deployed. Live Auth/HTTP and multi-connection claim tests are scheduled in 8B.

## Remaining work

| Phase                  | State       | Next checkpoint                                     |
| ---------------------- | ----------- | --------------------------------------------------- |
| 2 — Persistence        | NOT STARTED | Async adapter contract, portable ordered migrations |
| 3 — Setup/settings     | NOT STARTED | Shared shell and first-run save                     |
| 4 — Products/stock     | NOT STARTED | Catalog editor and atomic opening stock             |
| 5 — Checkout/output    | NOT STARTED | Atomic receipt counter and sale completion          |
| 6 — History/reports    | NOT STARTED | History and return flow                             |
| 7 — Import/recovery    | NOT STARTED | CSV preview/import, then backup/restore             |
| 8A — Sync engine       | NOT STARTED | Transport boundary and two-device tests             |
| 8B — Cloud integration | NOT STARTED | Deployment-state inspection and Auth setup          |
| 9 — Mobile hardware    | NOT STARTED | Camera/OTG verification                             |
| 10 — Release           | NOT STARTED | Packaged install/update acceptance                  |

## Active checkpoint record

- Phase/checkpoint: 2 / A, not started.
- Base commit: inspect current HEAD when starting; preserve unrelated changes.
- Built in this planning update: revised prompts and status tracker only.
- Automated implementation checks: pending Phase 2 work.
- Hardware/live checks: pending Phase 2 work.
- Open review findings: no Phase 2 review yet.
- Required decisions: none to start Phase 2. Restore/device-identity choices are addressed before implementing Phase 7; unresolved cross-device offline-return policy must be raised during sync work.
- Next action: implement Prompt 2; run its contract/build/hardware checks; independently review before marking READY.

Update this record using the completion template in BUILD_PROMPTS.md. Never mark unrun hardware checks as passed.
