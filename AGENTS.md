# AGENTS.md — VaporFlow Build Rules

## Code standards
- TypeScript strict mode, no `any`. Validate all external data with zod.
- Money is integers, never floats (see SPEC sections 6 and 8). Quantities are integers.
- English-only UI, large touch targets, keyboard friendly.
- IDs are UUID v7 generated on the device.

## Architecture
- All database access goes through repositories in `packages/core`. No SQL inside UI components.
- Any operation that must be atomic is exactly one `DbAdapter.batch()` call.
- Synced tables follow the common columns in SPEC section 6; ledger tables are insert-only.
- Platform adapters are defined in `packages/core` and implemented per platform.

## Workflow
- Build only the current phase; no extra features.
- Never edit `docs/SPEC.md`. If the spec is unclear or wrong, stop and ask.
- Small commits named `phaseN: summary`.
- Add tests for all money, stock, report and sync logic.
- Before saying done, run `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- End every task with a report: what you built, what you did not build, how to run and verify, known issues.
