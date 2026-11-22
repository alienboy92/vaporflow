# VaporFlow — Phase 9 review

Updated 17 November 2026. Scope: camera scanner, OTG scanner, mobile finishing. Implementation commit `d14fa59`, review-repair commit recorded in `docs/BUILD_STATUS.md`. `docs/SPEC.md` and `docs/BUILD_PROMPTS.md` are unchanged.

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
| `pnpm test` | PASS — 160 tests across 25 files (was 152; +8 back-nav/wedge/abandon-cart unit tests), plus 2 skipped opt-in benchmarks and 3 skipped env-gated live tests |
| `pnpm --filter @vaporflow/app build` | PASS |
| `pnpm build:desktop` (Electron NSIS) | PASS — unsigned dev build, as before |
| `pnpm --filter @vaporflow/mobile build` + `cap sync android` + `gradlew assembleDebug` | PASS — debug APK builds with the scanner/app plugins (3m 27 s) |

## Remaining acceptance (hardware)

**On-device session, 17 November 2026** (Samsung Galaxy A05s, Android 15, over Wi-Fi wireless debugging): verified live — camera permission prompt appears and camera scan works after granting; denied permission shows the red "Camera permission was denied…" alert (see the bug below); wedge toggle switches to `inputMode="none"` and the soft keyboard does not appear on the focused scan field; the wedge preference persists across screens (Sale → Products modal header shows the Scanner toggle); Back closes the Create Product modal, then navigates back to the Sale screen, then minimizes at the sale root with no prompt (empty cart); relaunching after minimize shows the PIN lock screen.

**Bug found by the walkthrough, fixed**: the `@capacitor-mlkit/barcode-scanning` plugin ships an empty Android manifest, so `android.permission.CAMERA` was never declared in the generated app manifest — Android instant-denied the request with no dialog and the UI silently did nothing. Fixed by declaring the permission and by the adapter throwing a visible error on denial instead of returning `null`; because `apps/mobile/android` is git-ignored and regenerated, `scripts/android.ps1` now patches the permission in idempotently on every run (verified by a strip-and-repatch round-trip).

**Second bug found by the walkthrough, fixed**: confirming the Back-button "Abandon this sale? The cart will be cleared." dialog minimized the app but kept the cart — the dialog promised a clear that never happened (the Shell only minimized; the WebView retains state). Fixed by registering the cart-clearing action from SaleScreen (`setSaleAbandonHandler` in `utils/back-nav.ts`); the Shell now calls `abandonSaleCart()` after confirmation, so the cart really is cleared, matching the dialog's wording. Verified on-device: adding a scanned item, confirming Back, relaunching — the cart is empty.

NOT RUN — needs a physical Android phone with a camera and a USB-OTG scanner:

- The full 20-barcode camera scan sweep and repeated scans, background/resume mid-scan, and cancellation from the scanner UI.
- A real USB-OTG scanner typing into the wedge-mode field (suppression is verified; the scanner itself is not).
- The complete phone walkthrough at 390×844: setup, products, stock, sale, receipt/share, return, expense/report, backup, sync problems.
- The Phase 2–8 device checks also remain pending.

Verified with fixture data on-device: barcode→cart add, cart-abandon confirm (cancel keeps the cart and app; OK clears the cart and minimizes, cart empty after relaunch).

## Known issues / notes

### 18 November device retest

On a Samsung SM-A055F, the Products CSV importer added 20 new products under **Scan QA**, each with a unique generated barcode, price PKR 2 and opening quantity 5. Android keyboard events entered all 20 barcodes into Sale in wedge mode. The cart showed 20 items and PKR 40. Three consecutive entries of the same existing barcode separately produced quantity 3. Confirming Android Back cleared the test cart. No checkout was posted. The fixtures remain in the phone's local catalog.

Sale, Products, Stock, Sales, Reports, Expenses and Settings had no page-level horizontal overflow at native width (384 CSS pixels) or at an emulated 390 × 844 on the phone. The camera button fell below the required 44 px width. The shared button now has a minimum width and an accessible label. The scanner adapter requests the Google scanner module when missing and surfaces scan failures while handling native cancellation quietly. Two regression tests exercise these paths.

Physical OTG equipment and a set of printed barcodes were unavailable. The 20-code run exercised simulated keyboard input. The full transaction/share/restore walkthrough and physical cloud-reconnect checks remain open. Immediate resume after minimizing retained the unlocked screen in this session. The PIN lock follows its configured idle deadline on resume.

- Navigating away from the sale screen by the bottom nav (not the Back button) still discards the cart without confirmation — pre-existing Phase 5 behavior, unchanged; the Back-button confirm now matches the prompt's wording ("abandoning an active sale").
- Camera scan in Stock In matches exact barcodes only (the same rule as sale-scan exact match); partial matches intentionally do not select a variant to avoid restocking the wrong item.
- `window.confirm` renders as a system dialog in the Android WebView — acceptable for the confirm-abandon prompt; a custom sheet can replace it later if the walkthrough shows friction.
