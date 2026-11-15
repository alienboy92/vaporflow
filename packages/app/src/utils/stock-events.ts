/** Event used to refresh stock-derived UI (low-stock badge) immediately after mutations. */
export const STOCK_CHANGED_EVENT = 'vaporflow:stock-changed';

/** Call after any operation that can change stock on hand or low-stock status. */
export function notifyStockChanged(): void {
  window.dispatchEvent(new Event(STOCK_CHANGED_EVENT));
}
