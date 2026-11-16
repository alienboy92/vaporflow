# Phases 4–7 repair and Phase 8A handoff

16 November 2026. Base: `97f18f1`. Repair commits: `a0c6c66` (recovery/import/stock), `e3760ea` (return receipts/report scale). This report supersedes the earlier phase-review claims where they conflict. SPEC.md is unchanged.

## Result

READY TO START PHASE 8A's local engine and simulated-device work. Phases 4–7 remain READY FOR HARDWARE CHECK, not fully hardware-accepted. No sync engine, hosted service, authentication, or cloud enrollment was built in this repair.

## Confirmed findings repaired

- Stock adjustments calculate the difference inside the write transaction. Concurrent counts of 5 against stock 10 now leave 5, not 0; an unchanged count creates no movement. Stock forms have synchronous submission guards.
- Failed CSV chunks restore cached category/product/variant maps and success counts. A failed first 200-row chunk followed by one valid row reports one import, with valid parents. Retrying imports the missing 200 rows without repeating opening stock.
- Restore works against a populated database. Replacement, receipt counter, active settings, sync-cursor cleanup, and delete-trigger reinstatement are one DbAdapter.batch(). Ledger update guards remain installed throughout. Delete guards are removed only inside this explicit whole-backup transaction and reinstated before commit. A failure rolls back both DDL and data; ordinary repository operations still cannot modify/delete ledger history. This uses SQLite transactional replacement rather than separate physical database-file activation.
- Counter recovery uses the higher of the existing local counter and restored receipt suffixes, preserving the last-used convention. Injected failures before counter recovery and before trigger reinstatement leave the old data, counter, and ledger protections intact.
- Restore keeps the active local device and PIN. When the backup lacks that device, its local row is retained in the restored shop. Conflicting device codes fail before replacement. A clean restore selects a live backed-up device. Checkout, catalog, stock, expenses, and returns now resolve active_device_id rather than using the first device in the shop. Stale pull_cursor* and last_sync_at settings are cleared.
- Large restores combine consecutive insert statements below 900 bound parameters per statement, preserving a single transaction while avoiding the adapter's 10,000-statement limit for the tested 10,001-variant case.
- Return receipts open after a completed return and can be reopened from sales history, printed, or shared as PDF. They show original receipt, return ID/date, saved refund amounts, quantities, restock decisions, refund method, and note. Negative saved refunds are not clamped. HTML content is escaped.
- The required scale benchmark exposed repeated full scans of sale_items in the daily series. The original run was stopped after more than two minutes; no exact completed baseline timing is claimed. Grouping item costs once removed the repeated scans without changing report semantics.

The pre-existing untracked review-probe.test.ts was converted into regression tests for correct behavior and its unused imports removed.

## Verification

| Check | Result |
| --- | --- |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| pnpm test | PASS: 115 tests, 2 opt-in tests skipped; 20 passing files and 1 skipped file |
| pnpm --filter @vaporflow/app build | PASS; existing bundle-size and Zod annotation warnings |
| pnpm --filter @vaporflow/desktop test:contract | PASS: 6 native Electron checks, including populated restore, failed replacement, and ledger guards |
| Capacitor adapter contract | PASS with a SQLite-backed plugin double; not a physical Android test |
| Full-scale report benchmark | PASS: report cards, daily series, both top-10 queries combined 249.4 ms; inventory 61.2 ms |
| CSV 2,000 rows | PASS: final suite measured 660 ms; reimport creates no duplicates |
| Restore 10,001 variants | PASS through BatchSchema validation |

Benchmark environment: Windows, Node v24.17.0, Vitest, better-sqlite3 in-memory database. Dataset: 50,000 sales and sale items across all 12 months of 2026, 10,000 products/variants, 100,000 stock movements. These are repository timings, not packaged UI or phone measurements.

Run from the repository root:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @vaporflow/app build
pnpm --filter @vaporflow/desktop test:contract
$env:VAPORFLOW_BENCH = '1'
pnpm test -- packages/core/src/scale-benchmark.test.ts
Remove-Item Env:VAPORFLOW_BENCH
```

## Remaining acceptance

- Windows and physical Android CSV/export/restore round trips, restart after restore, and process-kill recovery. Automated transactional failure injection does not substitute for native crash testing.
- Real receipt/return PDF sharing and Windows 80 mm printing; A4 label printing/scanning; responsive layout and scanner checks carried from prior phases.
- Packaged-app and phone performance. The benchmark above does not establish those timings.
- Existing text-only PDF/logo limitation, large frontend bundle, and previously documented hardware checks remain.

Per BUILD_PROMPTS.md, unavailable hardware checks remain pending while independent preparation can continue. Phase 8A is local-only and may start now. Do not enroll real shop data in Phase 8B until Windows and Android recovery acceptance passes. This repair does not authorize deployment or cloud enrollment.
