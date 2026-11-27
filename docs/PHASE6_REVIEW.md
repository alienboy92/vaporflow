# Bali Hub POS — Phase 6 review

> Follow-up: [Phases 4–7 repair and current evidence](PHASE4_7_REPAIR.md) supersedes conflicting completion claims below.

Updated 16 November 2026. Scope: sales history, returns, expenses, and P&L reports. Implementation commit `395ea6b`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` is unchanged.

## What was built

- Core: Phase 1 legacy `ReturnRepo.processReturn` (atomic batch, in-batch `_operation_guards` re-checks, duplicate-ID rejection, remaining-quantity bounds, insert-only ledger) and `ReportRepo` (P&L netting refunds and restocked COGS, top items by quantity and profit, daily series) required no changes. The repair added two zod-validated read methods to `ReturnRepo` (`getReturns`, `getReturnItems` via `readRows` + `ReturnSchema`/`ReturnItemSchema`).
- Sales history (`SalesScreen`): list newest first, receipt/note search, date-range filter, per-day totals (count, revenue, refunds), detail/reprint reusing the shared `ReceiptModal` (all Phase 5 print/PDF fixes preserved).
- Returns (`SalesScreen` modal): per-line return quantities bounded by remaining sold quantity, restock/no-restock toggle, cash/online refund method defaulting to the sale's method, note, `processReturn` atomic batch, synchronous double-submit ref guard.
- Expenses (`ExpensesScreen`): list, add, edit, soft-delete with validated date, positive integer amount, category, and note.
- Reports (`ReportsScreen`): quick presets (Today, Yesterday, Last 7 days, This month, Last month) plus custom local date ranges, the nine SPEC P&L cards, top-10 tables by quantity and profit, and a Recharts daily trend chart. Local-timezone boundaries come from the Phase 1 `reportRange`/`localDate` helpers (correct for Asia/Karachi).

## Review findings and fixes

Independent review of `395ea6b` found nine issues; all are resolved:

1. **HIGH — false benchmark claim**: the test was titled "reproducible 12-month benchmark (50,000 sales)" but looped 50 times (the build report claimed 50,000/<3 s). Renamed honestly to a "50-sale smoke benchmark" and a real **1,000-sale benchmark** was added behind `VAPORFLOW_BENCH=1` (skipped by default, marked skipped in test output, never claimed as run).
2. **HIGH — raw SQL in the UI**: `SalesScreen` queried `returns`/`return_items` directly with hand-rolled, unvalidated row mapping. Replaced with `ReturnRepo.getReturns`/`getReturnItems` (zod-validated repository reads); AGENTS.md's "no SQL inside UI components" holds again.
3. **MEDIUM — throw outside try/catch in `handleSubmitReturn`**: the over-quantity check threw inside `.map` before the `try`, producing an unhandled rejection and a silent failure. Validation now runs before any async work and reports via in-modal error state.
4. **MEDIUM — return errors invisible**: the caught error rendered at the top of the page, behind the fixed `z-50` modal overlay. Errors now render inside the return modal (`returnError` state, cleared on open and on submit).
5. **MEDIUM — stale stock badge after a restocking return**: `notifyStockChanged()` is now called after a successful `processReturn`, so the low-stock badge updates immediately (Phase 4 pattern).
6. **LOW — unused dependency**: `react-day-picker@8.10.1` was never imported; removed from `packages/app/package.json` and the lockfile regenerated.
7. **LOW — fabricated device id**: `ExpensesScreen` set `device_id: shop.device_id || uuidv7()`, attributing expenses to the shop-creating device or a random one. It now loads the current device via `DeviceRepo` and refuses to save (with a clear message) when no device is registered.
8. **LOW — same-tick double-submit on expense save**: guarded only by React state (the same race fixed for checkout in Phase 5). Now uses a synchronous `submittingRef`.
9. **LOW — coverage/claims gaps**: the P&L test asserted 5 of 9 fields on an ad-hoc seed; it now asserts **all nine fields** (net_revenue 7000, net_cogs 3600, gross_profit 3400, expenses 500, net_profit 2900, sales_count 2, avg_sale_value 3500, cash 5000, online 2000). The returns test now also asserts on-hand stock after a restocked return (100 − 3 + 1 = 98), that a no-restock return writes no stock movement (on-hand stays 98; movement ledger stays at 3 rows), the full-return path, rejection of a further return, and the netted P&L after returns (net_revenue 0, net_cogs 2400, net_profit −2400). Dead `PlaceholderScreens.tsx` (no importers) was deleted.

## Verified correct (no change needed)

- `ReturnRepo.processReturn`: duplicate-ID rejection, remaining-quantity bounds enforced in-batch, insert-only movements/refunds, per-line refund via `calcRefundAmount` (rounding rule untouched), refund method defaulting to the sale's method.
- `ReportRepo.getProfitAndLoss` correctly nets refunds (by `returned_at`) and restocked COGS; `reportRange`/`localDate` handle Asia/Karachi local-day boundaries.
- `ReceiptModal` extraction preserved every Phase 5 print/share fix; the history reprint path is the same code as checkout.
- Expenses/Reports screens are fully repo-driven; money stays integer end to end.

## Verification (run during the repair)

| Check | Result |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 96 tests, 17 files, plus 1 honestly-skipped opt-in benchmark (`VAPORFLOW_BENCH=1` runs a real 1,000-sale benchmark, NOT RUN here) |
| `pnpm --filter @bali-hub-pos/app build` | PASS — 9.0 s production build |
| Bundle size note | Main chunk 842 kB (232 kB gzip) — recharts 2.13.3 dominates; lazy-loading `ReportsScreen` left as optional future work |

## Remaining acceptance (hardware/live)

Runtime behavior on real Electron and Android is NOT RUN and stays pending:

1. Electron: reprint a receipt from history through the system print dialog; verify the return modal end to end on real data.
2. Android: history/returns/expense/report flows at 390×844; receipt PDF share from history.
3. Carried over: Phase 2 Android acceptance, Phase 3 setup/PIN/idle-lock restart checks, Phase 4 device walkthrough, Phase 5 print/label/scanner checks (wedge scanner deferred per owner decision — see `docs/SCAN_ENTRY.md`).

## Known issues / notes

- The sales history list loads all sales without pagination — acceptable at current volumes; revisit at Phase 7/8.
- Per-day refund totals on the history screen attribute a refund to the sale's date, while the P&L attributes it to `returned_at` (the ledger-correct choice). A same-day display inconsistency only; documented, not "fixed" either way.
- `react-day-picker` removal regenerated the lockfile (2 packages removed).
- Recharts is a deprecated version warning (2.13.3); upgrade can ride along with a future dependency pass.
