# VaporFlow — Phase 9 review

Updated 17 November 2026. Scope: camera scanner, OTG scanner, mobile finishing. Implementation commit `1a82b32`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` and `docs/BUILD_PROMPTS.md` are unchanged.

## What was built (as reviewed)

- `apps/mobile/src/scanner.ts`: `capacitorScanner` implementing the core `ScannerAdapter` over `@capacitor-mlkit/barcode-scanning` — permission check → request → scan → `null` on cancellation/error, exposed through `createMobileDatabase` and `DbProvider` (desktop receives an explicit "unsupported" stub).
- `Shell.tsx`: a native `backButton` listener.
- Plugins registered in the Android project (`capacitor.plugins.json`).

## Review verdict: BLOCKED (4 findings) — all repaired

1. **HIGH — the camera scanner was unreachable from the UI**: the implementation commit touched no screens; `scanWithCamera` had zero call sites, and the claimed "📷 Camera" buttons in Sale/Products did not exist. **Fixed**: shared `ScanControls.tsx` (`CameraScanButton`) wired into the SaleScreen scan field (result runs the same match-and-add path as a typed scan), ProductsScreen's per-variant barcode inputs, and Stock In rows (scan-to-select the variant by barcode; unmatched barcodes surface the existing error field). The desktop stub's "Camera scanning is only available on the mobile app" error surfaces in the screen error fields.
2. **HIGH — the OTG keyboard-wedge mode was entirely absent**: no `inputMode`, no toggle anywhere. **Fixed**: `utils/wedge.ts` (persisted `vaporflow_wedge_mode` preference + `useWedgeMode` hook) and a visible `⌨ Manual / 🔌 Scanner` toggle on the Sale scan field and the Products create/edit modal; in wedge mode barcode inputs use `inputMode="none"` so the soft keyboard never pops up while a physical OTG scanner types into the focused field (Enter-to-advance between variant barcode rows is preserved). Manual entry stays one tap away, per the prompt.
3. **MEDIUM — back button only closed the More drawer and over-prompted**: no dialog was closable via Back (receipt, return, reprint, expense, restore, product/CSV, stock modals), and at the sale root it always prompted "Abandon active sale?" even with an empty cart or existing history. **Fixed**: `utils/back-nav.ts` — a LIFO registry (`registerBackHandler`) that screens hold open for each modal's lifetime; the Shell drains it top-down before anything else. The sale-root confirm now fires only when `setSaleCartActive` reports a non-empty cart (tracked by SaleScreen), and a confirmed abandonment minimizes the app instead of a no-op `history.back()`. An empty cart at the sale root minimizes without prompting; other routes navigate back; the lock screen still ignores Back. Desktop keyboard shortcuts are untouched (the listener is native-only).
4. **LOW — BUILD_STATUS overclaims**: the Phase 9 row claimed camera buttons and the wedge toggle that did not exist, and a "390×844 audit" that produced no code changes. Corrected; the layout audit is folded into the pending device walkthrough (screens do use `min-h-11` touch targets and responsive grids from earlier phases, so no regression is expected there).

## Verified correct (no change needed)

- `capacitorScanner` permission/cancel/error semantics and the platform boundary (desktop stub, mobile adapter).
- Android plugin registration for `@capacitor-mlkit/barcode-scanning` and `@capacitor/app`.
- No money/stock/sync logic touched by this phase's diff.

## Verification (run during the repair)

| Check | Result |
| ------------------------------------------------- | ------------------------------------------------------- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 159 tests across 25 files (was 152; +7 back-nav/wedge unit tests), plus 2 skipped opt-in benchmarks and 3 skipped env-gated live tests |
| `pnpm --filter @vaporflow/app build` | PASS |
| `pnpm build:desktop` (Electron NSIS) | PASS — unsigned dev build, as before |
| `pnpm --filter @vaporflow/mobile build` + `cap sync android` + `gradlew assembleDebug` | PASS — debug APK builds with the scanner/app plugins (3m 27 s) |

## Remaining acceptance (hardware)

NOT RUN — needs a physical Android phone with a camera and a USB-OTG scanner:

- Scan 20 different barcodes by camera and by OTG wedge; repeated scans, cancellation, denied permission, background/resume.
- Phone walkthrough at 390×844: setup, products, stock, sale, receipt/share, return, expense/report, backup, sync problems — including the wedge toggle's soft-keyboard suppression and the back-button dialog stack on-device.
- The Phase 2–8 device checks also remain pending.

## Known issues / notes

- Navigating away from the sale screen by the bottom nav (not the Back button) still discards the cart without confirmation — pre-existing Phase 5 behavior, unchanged; the Back-button confirm now matches the prompt's wording ("abandoning an active sale").
- Camera scan in Stock In matches exact barcodes only (the same rule as sale-scan exact match); partial matches intentionally do not select a variant to avoid restocking the wrong item.
- `window.confirm` renders as a system dialog in the Android WebView — acceptable for the confirm-abandon prompt; a custom sheet can replace it later if the walkthrough shows friction.
