# SCAN_ENTRY — Barcode scan entry in Add Product (build plan)

Status: PLANNED — not built. Owner hardware: **Media Link 2D barcode scanner over USB (keyboard-wedge / HID)**. Owner decision 16 November 2026: do not implement camera scanning; scanning happens through the USB scanner, manual typing stays available. Hand this document to the builder as the feature prompt.

## Goal

In the product create/edit modal, the operator can fill any variant barcode field either by typing or by scanning with the USB scanner, with no extra clicks and no behavior change for manual entry. The same scan handling also applies to the SaleScreen scan/search input.

## Background: how a USB wedge scanner behaves

A Media Link 2D scanner in HID keyboard mode is a keyboard: it "types" the decoded payload very fast and sends a configurable suffix key (usually Enter). This means:

- No new code path is required to receive scans — the focused input receives keystrokes. The work is in focus management, sanitization, and edge cases.
- A **2D** scanner reads QR, Data Matrix, PDF417 and GS1 symbologies, so payloads may contain letters, URLs, newlines, and GS1 group separators (`\x1D`, `GS`), not only 13 digits. The input must tolerate this.
- Enter inside the product form must never submit the form (the Phase 4 rule "Enter in barcode fields advances focus and never submits" stays).

## Behavior spec

1. **Manual entry unchanged.** Typing, Generate button, editing, and clearing a barcode field behave exactly as in Phase 4.
2. **Scanning fills the focused barcode field.** The operator clicks/tabs into a barcode field (or it is already focused) and scans; the value arrives at keyboard speed and the state updates per keystroke.
3. **Enter after a scan advances focus** to the next variant's barcode field; from the last row it stays put. The form does not submit. (Existing behavior — keep and verify.)
4. **Modal open focus:** when the create modal opens normally, focus goes to Product Name (typing flow is primary there). When it opens with a prefilled barcode from the SaleScreen not-found flow (`prefillBarcode` state), focus goes to the first barcode field so a rescan or correction is immediate.
5. **Sanitization of scanned payloads:** scanned input passes through one shared pure util, `normalizeScannedBarcode(raw: string): string` (new file `packages/app/src/utils/scan-input.ts`):
   - trim leading/trailing whitespace;
   - strip control characters: newlines, carriage returns, tabs, GS1 group separators (`\x1D`), and other C0 controls;
   - for payloads with separators, keep the first field only (a QR marketing payload reduced to its leading segment is better than a 200-char barcode);
   - cap length at 64 characters;
   - never mutate a value the operator typed character-by-character beyond these same normalizations (apply uniformly on change).
   - Wire it into: every variant barcode `onChange` in the product modal, and the SaleScreen scan/search input.
6. **Duplicate barcodes:** scanning a barcode that already exists still produces the existing clear repo error backed by the `variants(shop_id, barcode)` partial unique index, with full rollback of the save. No change; verify only.
7. **SaleScreen:** the wedge scan input already supports rapid multi-scans and exact matching; after adding normalization it must still produce quantity 3 from three rapid scans of the same code (regression test exists at the repo level; add an app-level check if practical).

## Non-goals

- No camera scanning (explicitly rejected by the owner for now).
- No new npm dependencies.
- No SPEC.md, schema, or migration changes.
- No scanner-driver code: the scanner is configured out-of-band (below).
- Optional stretch (needs owner decision, default NO): scan-to-select a variant in Stock In / Adjustments. Leave out unless the owner asks.

## Implementation notes for the builder

- All UI work lives in `packages/app/src/screens/ProductsScreen.tsx` (barcode inputs + modal-open focus), `packages/app/src/screens/SaleScreen.tsx` (scan input normalization), and the new `packages/app/src/utils/scan-input.ts`. No SQL in UI; repositories untouched.
- Keep TypeScript strict, no `any`; the util is a pure string function so it gets direct unit tests without DOM.
- Focus management uses the existing `barcodeInputRefs` array; do not introduce auto-focus racing with React strict effects.
- Keyboard accessibility and ≥44 px touch targets are unchanged.

## Tests

- Unit: `normalizeScannedBarcode` — plain digits; a URL-style QR payload; a GS1 payload with `\x1D`; embedded newline/tab; over-length input; empty string.
- App-level (if the existing test harness allows): barcode field Enter-advances and never submits the form.
- Preserve all 92 existing tests; add the new ones on top.

## Scanner configuration (owner, out-of-band)

Using the Media Link programming card/manual, set the scanner to:

1. Interface: **USB HID keyboard** (not USB serial/COM).
2. Terminator/suffix: **Enter (CR)** after each scan.
3. No prefix characters.
4. 2D symbologies enabled as needed (QR/Data Matrix/PDF417).

## Acceptance (owner hardware checks)

Record as NOT RUN until the owner verifies on the real device:

1. Desktop Electron: open Add Product, focus a barcode field, scan an EAN-13 product → field fills, Enter moves focus, form does not submit; then type a barcode manually → unchanged.
2. Scan the same code twice into two variants → second save fails with the clear duplicate error, nothing partial is written.
3. Scan a QR code containing a URL → the field contains the sanitized first segment only.
4. Android (when this ships on device): same walkthrough with the OTG-connected scanner.
5. SaleScreen: three rapid scans of one code → one cart line with quantity 3.

## Suggested build slot and commit

Small, self-contained UI feature. Recommended: fold into the **Phase 6 build** (add this document to the builder's reading list in that prompt) and commit as `phase6: wedge scan entry for product barcodes`. If the owner wants it sooner, it can be built standalone with the same commit prefix and a BUILD_STATUS note — no other phases are blocked either way.

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass with the new tests included.
- `docs/BUILD_STATUS.md` updated: feature listed as built, hardware acceptance recorded as NOT RUN (not claimed).
- SPEC.md untouched.
