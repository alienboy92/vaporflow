import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerBackHandler,
  handleBackThroughDialogs,
  clearBackHandlers,
  setSaleCartActive,
  isSaleCartActive,
  setSaleAbandonHandler,
  clearSaleAbandonHandler,
  abandonSaleCart,
} from './back-nav';

describe('Android back-button coordination (Phase 9)', () => {
  beforeEach(() => {
    clearBackHandlers();
    setSaleCartActive(false);
  });

  it('returns false when no dialogs are open', () => {
    expect(handleBackThroughDialogs()).toBe(false);
  });

  it('closes the newest dialog first (LIFO) and stops once handled', () => {
    const order: string[] = [];
    const unA = registerBackHandler(() => {
      order.push('A');
      return true;
    });
    const unB = registerBackHandler(() => {
      order.push('B');
      return true;
    });
    expect(handleBackThroughDialogs()).toBe(true);
    expect(order).toEqual(['B']);
    expect(handleBackThroughDialogs()).toBe(true);
    expect(order).toEqual(['B', 'B']);
    unB();
    unA();
    expect(handleBackThroughDialogs()).toBe(false);
  });

  it('falls through handlers that decline (return false)', () => {
    const order: string[] = [];
    registerBackHandler(() => {
      order.push('bottom');
      return true;
    });
    registerBackHandler(() => {
      order.push('top');
      return false; // declines: e.g. its dialog is conditionally closed
    });
    expect(handleBackThroughDialogs()).toBe(true);
    expect(order).toEqual(['top', 'bottom']);
  });

  it('unregistering an already-removed handler is a no-op', () => {
    const un = registerBackHandler(() => true);
    un();
    expect(() => un()).not.toThrow();
    expect(handleBackThroughDialogs()).toBe(false);
  });

  it('tracks the sale-cart flag for the Shell', () => {
    expect(isSaleCartActive()).toBe(false);
    setSaleCartActive(true);
    expect(isSaleCartActive()).toBe(true);
    setSaleCartActive(false);
    expect(isSaleCartActive()).toBe(false);
  });

  it('clears the confirmed-abandoned cart through the registered handler', () => {
    let cleared = 0;
    expect(abandonSaleCart()).toBe(false); // no SaleScreen mounted
    setSaleAbandonHandler(() => {
      cleared += 1;
    });
    expect(abandonSaleCart()).toBe(true);
    expect(cleared).toBe(1);
    clearSaleAbandonHandler();
    expect(abandonSaleCart()).toBe(false);
    expect(cleared).toBe(1);
  });
});

describe('OTG wedge preference (Phase 9)', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to manual mode and persists toggles', async () => {
    const { readWedgePref, writeWedgePref } = await import('./wedge');
    expect(readWedgePref()).toBe(false);
    writeWedgePref(true);
    expect(readWedgePref()).toBe(true);
    writeWedgePref(false);
    expect(readWedgePref()).toBe(false);
  });

  it('survives missing localStorage', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);
    const { readWedgePref, writeWedgePref } = await import('./wedge');
    expect(() => writeWedgePref(true)).not.toThrow();
    expect(readWedgePref()).toBe(false);
  });
});
