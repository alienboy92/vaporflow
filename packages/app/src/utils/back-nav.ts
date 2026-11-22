/**
 * Android back-button coordination.
 *
 * Screens register LIFO handlers while a dialog/modal is open; the Shell's
 * native `backButton` listener drains the stack top-down. A handler returns
 * true when it consumed the press (e.g. closed its dialog) so the Shell stops.
 * The sale-cart flag lets the Shell confirm before abandoning an in-progress
 * sale at the sale root, without reaching into the screen's state.
 */

export type BackHandler = () => boolean;

const stack: BackHandler[] = [];

/**
 * Registers a handler for the lifetime of an open dialog. The returned
 * function unregisters it (call from the effect cleanup).
 */
export function registerBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const index = stack.indexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

/**
 * Gives the topmost handler (newest dialog) the first chance, then falls
 * through the stack. True when any handler consumed the press.
 */
export function handleBackThroughDialogs(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.()) return true;
  }
  return false;
}

export function clearBackHandlers(): void {
  stack.length = 0;
}

let saleCartActive = false;
let saleAbandonHandler: (() => void) | null = null;

/** Tracks whether an in-progress sale cart holds items (called by SaleScreen). */
export function setSaleCartActive(active: boolean): void {
  saleCartActive = active;
}

export function isSaleCartActive(): boolean {
  return saleCartActive;
}

/**
 * Registers the action that clears the active sale cart. The Shell calls it
 * after the user confirms abandoning the sale on Back, so the cart really is
 * cleared (the dialog says so) even though the WebView keeps its state.
 */
export function setSaleAbandonHandler(handler: () => void): void {
  saleAbandonHandler = handler;
}

export function clearSaleAbandonHandler(): void {
  saleAbandonHandler = null;
}

/** Clears the cart via the registered handler; true when one was registered. */
export function abandonSaleCart(): boolean {
  if (!saleAbandonHandler) return false;
  saleAbandonHandler();
  return true;
}
