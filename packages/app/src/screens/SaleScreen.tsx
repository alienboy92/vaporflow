import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '../context/DbProvider';
import {
  ProductRepo,
  StockRepo,
  SaleRepo,
  ShopRepo,
  DeviceRepo,
  uuidv7,
  formatMoney,
  roundRatio,
} from '@vaporflow/core';
import type { Shop, Variant, Sale, SaleItem } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';
import { useCloudSync } from '../context/CloudSyncProvider';
import { ReceiptModal } from '../components/ReceiptModal';

interface CartLine {
  variant_id: string;
  product_name: string;
  variant_name: string;
  list_price: number;
  unit_price: number;
  qty: number;
  on_hand: number;
  cost_price: number;
}

export function SaleScreen() {
  const db = useDb();
  const saleCompleted = useCloudSync().saleCompleted;
  const navigate = useNavigate();
  const [shop, setShop] = useState<Shop | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [variants, setVariants] = useState<(Variant & { product_name: string; on_hand: number })[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [amountReceivedInput, setAmountReceivedInput] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('0');
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  // Scanned value with no matching product; enables the create-product offer.
  const [notFoundQuery, setNotFoundQuery] = useState('');

  // Completed receipt modal state
  const [completedResult, setCompletedResult] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  // Synchronous double-submit guard: React state cannot reflect two keydown
  // events fired within the same frame (F9 double-tap), so the ref decides.
  const completingRef = useRef(false);

  const loadCatalog = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const productRepo = new ProductRepo(db);
      const stockRepo = new StockRepo(db);
      const deviceRepo = new DeviceRepo(db);

      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);

      const device = await deviceRepo.getActiveDevice(activeShop.id);
      setDeviceId(device?.id ?? null);

      const allProds = await productRepo.getProducts(activeShop.id);
      const allVars = await productRepo.getVariants(activeShop.id);
      const stockList = await stockRepo.getStockOnHand(activeShop.id);
      const stockMap: Record<string, number> = {};
      for (const s of stockList) stockMap[s.variant_id] = s.on_hand;

      const prodMap = new Map(allProds.map((p) => [p.id, p.name]));

      const list = allVars
        .filter((v) => v.is_active === 1)
        .map((v) => ({
          ...v,
          product_name: prodMap.get(v.product_id) ?? 'Product',
          on_hand: stockMap[v.id] ?? 0,
        }));

      setVariants(list);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load sales catalog');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Focus scan input helper
  const focusScan = useCallback(() => {
    scanInputRef.current?.focus();
  }, []);

  // Add or increment item in cart
  const addToCartByVariantId = useCallback((variantId: string) => {
    const v = variants.find((item) => item.id === variantId);
    if (!v) return;

    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.variant_id === variantId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        const item = updated[existingIndex]!;
        updated[existingIndex] = { ...item, qty: item.qty + 1 };
        return updated;
      } else {
        return [
          ...prev,
          {
            variant_id: v.id,
            product_name: v.product_name,
            variant_name: v.name,
            list_price: v.sale_price,
            unit_price: v.sale_price,
            qty: 1,
            on_hand: v.on_hand,
            cost_price: v.cost_price,
          },
        ];
      }
    });
    setSearchQuery('');
    focusScan();
  }, [variants, focusScan]);

  // Totals for the current cart; shared by the summary display and completion.
  const computeTotals = useCallback(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0);
    const percent = Math.min(100, Math.max(0, parseInt(discountPercentInput || '0', 10)));
    // Integer-safe percent conversion using core roundRatio (half rounds up).
    const percentDiscount = Number(roundRatio(BigInt(subtotal) * BigInt(percent), 100n));
    const rawDiscount =
      discountMode === 'amount'
        ? Math.max(0, parseInt(discountInput || '0', 10))
        : percentDiscount;
    const discountExceedsSubtotal = rawDiscount > subtotal;
    const discountAmount = Math.min(rawDiscount, subtotal);
    const total = subtotal - discountAmount;
    return { subtotal, discountAmount, discountExceedsSubtotal, total };
  }, [cart, discountMode, discountInput, discountPercentInput]);

  const handleCompleteSale = useCallback(async () => {
    if (!shop || !deviceId || cart.length === 0) return;
    // Synchronous guard: two F9 keydowns in the same tick both pass the
    // React state check, so the ref decides before any async work starts.
    if (completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    setError('');

    try {
      const saleRepo = new SaleRepo(db);
      const saleId = uuidv7();
      const itemIds = cart.map(() => uuidv7());
      const movementIds = cart.map(() => uuidv7());
      const nowIso = new Date().toISOString();

      const totals = computeTotals();
      if (totals.discountExceedsSubtotal) {
        setError('Discount cannot exceed the subtotal.');
        return;
      }
      const amountReceived = paymentMethod === 'cash' ? parseInt(amountReceivedInput || '0', 10) : totals.total;

      const input = {
        shop_id: shop.id,
        device_id: deviceId,
        sold_at: nowIso,
        payment_method: paymentMethod,
        amount_received: paymentMethod === 'cash' ? amountReceived : null,
        discount_amount: totals.discountAmount,
        note: note.trim() || null,
        lines: cart.map((c) => ({
          variant_id: c.variant_id,
          product_name: c.product_name,
          variant_name: c.variant_name,
          qty: c.qty,
          list_price: c.list_price,
          unit_price: c.unit_price,
        })),
      };

      const result = await saleRepo.completeSale(input, saleId, itemIds, movementIds, nowIso);
      setCompletedResult(result);
      notifyStockChanged();
      // Debounced cloud sync trigger; a no-op when cloud is not connected.
      saleCompleted();
      setCart([]);
      setDiscountInput('0');
      setDiscountPercentInput('0');
      setAmountReceivedInput('');
      setNote('');
      // Refresh the catalog so stock displays reflect the completed sale.
      void loadCatalog();
    } catch (err: unknown) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to complete sale');
    } finally {
      completingRef.current = false;
      setCompleting(false);
    }
  }, [shop, deviceId, cart, paymentMethod, amountReceivedInput, note, db, computeTotals, loadCatalog, saleCompleted]);

  // Keyboard shortcuts: F2 (focus scan), F9 (complete sale), Esc (clear cart)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        focusScan();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && !completingRef.current) {
          void handleCompleteSale();
        }
      } else if (e.key === 'Escape') {
        if (cart.length > 0 && !completedResult) {
          if (window.confirm('Clear current cart?')) {
            setCart([]);
            focusScan();
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, completedResult, focusScan, handleCompleteSale]);

  useEffect(() => {
    focusScan();
  }, [focusScan]);

  // Handle barcode scan / search submit
  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // Check exact barcode match
    const matchedBarcode = variants.find((v) => v.barcode?.toLowerCase() === query.toLowerCase());
    if (matchedBarcode) {
      addToCartByVariantId(matchedBarcode.id);
      return;
    }

    // Check exact SKU match
    const matchedSku = variants.find((v) => v.sku?.toLowerCase() === query.toLowerCase());
    if (matchedSku) {
      addToCartByVariantId(matchedSku.id);
      return;
    }

    // If query matches single variant name/product name uniquely
    const matches = variants.filter(
      (v) =>
        v.product_name.toLowerCase().includes(query.toLowerCase()) ||
        v.name.toLowerCase().includes(query.toLowerCase()) ||
        v.barcode?.includes(query) ||
        v.sku?.toLowerCase().includes(query.toLowerCase()),
    );

    if (matches.length === 1) {
      addToCartByVariantId(matches[0]!.id);
    } else if (matches.length === 0) {
      setNotFoundQuery(query);
      setError(`No product found matching "${query}".`);
      setTimeout(() => {
        setError('');
        setNotFoundQuery('');
      }, 8000);
    }
  }

  // Offer: jump to the products catalog with the scanned barcode prefilled.
  function handleCreateFromScan() {
    const barcode = notFoundQuery;
    setNotFoundQuery('');
    setError('');
    setSearchQuery('');
    navigate('/products', { state: { prefillBarcode: barcode } });
  }

  // Cart quantity / price / remove handlers
  function updateQty(index: number, qty: number) {
    if (qty <= 0) {
      removeItem(index);
      return;
    }
    setCart((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index]!, qty };
      return updated;
    });
  }

  function updatePrice(index: number, unit_price: number) {
    setCart((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index]!, unit_price: Math.max(0, unit_price) };
      return updated;
    });
  }

  function removeItem(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  // Totals calculation
  const { subtotal, discountExceedsSubtotal, total } = computeTotals();
  const amountReceived = paymentMethod === 'cash' ? parseInt(amountReceivedInput || '0', 10) : total;
  const changeDue = Math.max(0, amountReceived - total);
  // Non-blocking warning: completing a cash sale short still succeeds on
  // purpose (no data blocking), but the cashier must see it before F9.
  const cashShort = paymentMethod === 'cash' && amountReceivedInput !== '' && amountReceived < total;

  if (loading) {
    return <div className="p-6 text-gray-600">Loading checkout...</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Checkout (Sale)</h1>
          <p className="text-sm text-gray-600">
            Scan barcode or search products. Press <kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono">F2</kbd> to focus scan, <kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono">F9</kbd> to complete sale.
          </p>
        </div>
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2 flex-wrap">
            <span>{error}</span>
            {notFoundQuery && (
              <button
                onClick={handleCreateFromScan}
                className="bg-red-700 hover:bg-red-800 text-white px-3 py-1.5 rounded font-medium min-h-11"
              >
                Create product with this barcode
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Layout: Desktop 2-column, Mobile 1-column */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Cart & Payment */}
        <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border p-4 md:p-6 flex flex-col justify-between space-y-6">
          <div>
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h2 className="text-lg font-bold text-gray-800">Current Cart ({cart.reduce((sum, i) => sum + i.qty, 0)} items)</h2>
              {cart.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('Clear cart?')) setCart([]);
                  }}
                  className="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1.5 rounded min-h-11 flex items-center"
                >
                  Clear Cart (Esc)
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-base font-medium">Cart is empty</p>
                <p className="text-sm">Scan a barcode or select items from the catalog below.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {cart.map((item, index) => {
                  const lineTotal = item.unit_price * item.qty;
                  const isNegativeStock = item.on_hand - item.qty < 0;
                  return (
                    <div
                      key={item.variant_id}
                      className="p-3 bg-gray-50 border rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {item.product_name} <span className="text-gray-500 font-normal">({item.variant_name})</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-600 mt-1">
                          <div className="flex items-center gap-1">
                            <span>Price:</span>
                            <input
                              type="number"
                              min="0"
                              value={item.unit_price}
                              onChange={(e) => updatePrice(index, parseInt(e.target.value || '0', 10))}
                              className="w-20 border rounded px-1.5 py-0.5 text-xs bg-white"
                              title="Click to override price"
                            />
                          </div>
                          <span>Stock: {item.on_hand}</span>
                          {isNegativeStock && (
                            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                              Low stock warning (negative allowed)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        {/* Qty controls */}
                        <div className="flex items-center border rounded bg-white">
                          <button
                            onClick={() => updateQty(index, item.qty - 1)}
                            className="px-3 py-1.5 hover:bg-gray-100 text-gray-700 font-bold min-h-11 min-w-11 flex items-center justify-center"
                            aria-label="Decrease quantity"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={(e) => updateQty(index, parseInt(e.target.value || '1', 10))}
                            className="w-12 text-center border-x py-1.5 text-sm focus:outline-none"
                          />
                          <button
                            onClick={() => updateQty(index, item.qty + 1)}
                            className="px-3 py-1.5 hover:bg-gray-100 text-gray-700 font-bold min-h-11 min-w-11 flex items-center justify-center"
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>

                        <div className="font-bold text-gray-900 w-24 text-right">
                          {formatMoney(lineTotal, 0, currency)}
                        </div>

                        <button
                          onClick={() => removeItem(index)}
                          className="text-red-500 hover:text-red-700 p-2 min-h-11 min-w-11 flex items-center justify-center font-bold"
                          title="Remove line"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart Summary & Checkout Actions */}
          {cart.length > 0 && (
            <div className="border-t pt-4 space-y-4">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotal, 0, currency)}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600 gap-2">
                  {discountMode === 'amount' ? (
                    <span>Discount ({currency})</span>
                  ) : (
                    <span>Discount (%)</span>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex border rounded overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setDiscountMode('amount')}
                        className={`px-3 py-1 text-xs font-medium min-h-11 ${
                          discountMode === 'amount' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                        aria-pressed={discountMode === 'amount'}
                      >
                        {currency}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountMode('percent')}
                        className={`px-3 py-1 text-xs font-medium min-h-11 ${
                          discountMode === 'percent' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                        aria-pressed={discountMode === 'percent'}
                      >
                        %
                      </button>
                    </div>
                    {discountMode === 'amount' ? (
                      <input
                        type="number"
                        min="0"
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value)}
                        className="w-28 border rounded px-2 py-1 text-right text-sm"
                        aria-label="Discount amount"
                      />
                    ) : (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={discountPercentInput}
                        onChange={(e) => setDiscountPercentInput(e.target.value)}
                        className="w-28 border rounded px-2 py-1 text-right text-sm"
                        aria-label="Discount percent"
                      />
                    )}
                  </div>
                </div>
                {discountExceedsSubtotal && (
                  <div role="alert" className="text-xs text-red-600">
                    Discount cannot exceed the subtotal.
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t">
                  <span>Total</span>
                  <span>{formatMoney(total, 0, currency)}</span>
                </div>
              </div>

              {/* Payment Method */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-3 rounded-lg font-medium border text-center min-h-11 transition-colors ${
                    paymentMethod === 'cash' ? 'bg-blue-700 text-white border-blue-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Cash Payment
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('online')}
                  className={`py-3 rounded-lg font-medium border text-center min-h-11 transition-colors ${
                    paymentMethod === 'online' ? 'bg-blue-700 text-white border-blue-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Online / Card
                </button>
              </div>

              {paymentMethod === 'cash' && (
                <div className="grid grid-cols-2 gap-4 items-center bg-gray-50 p-3 rounded-lg border">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cash Received ({currency})</label>
                    <input
                      type="number"
                      min={total}
                      value={amountReceivedInput}
                      onChange={(e) => setAmountReceivedInput(e.target.value)}
                      placeholder={total.toString()}
                      className="w-full border rounded px-3 py-2 text-sm bg-white"
                    />
                  </div>
                  <div className="text-right">
                    <span className="block text-xs font-medium text-gray-600">Change Due</span>
                    <span className="text-xl font-bold text-green-700">{formatMoney(changeDue, 0, currency)}</span>
                  </div>
                </div>
              )}

              {cashShort && (
                <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
                  Cash received is less than the total. The sale can still complete, but change due will be negative.
                </div>
              )}

              <div>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional sale note or customer reference..."
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>

              <button
                disabled={completing || cart.length === 0 || discountExceedsSubtotal}
                onClick={() => void handleCompleteSale()}
                className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white font-bold py-4 rounded-xl text-lg shadow transition-colors min-h-12 flex items-center justify-center gap-2"
              >
                {completing ? 'Completing Sale...' : `Complete Sale (F9) — ${formatMoney(total, 0, currency)}`}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Scanner Wedge & Catalog Quick Search */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border p-4 md:p-6 flex flex-col space-y-4">
          <h2 className="text-lg font-bold text-gray-800">Scan & Add Products</h2>

          <form onSubmit={handleSearchSubmit} className="space-y-2">
            <label htmlFor="barcode-scan" className="block text-xs font-medium text-gray-600">
              Barcode / SKU / Name Scan (F2)
            </label>
            <div className="flex gap-2">
              <input
                id="barcode-scan"
                ref={scanInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Scan barcode or type name..."
                className="flex-1 border rounded-lg px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                className="bg-gray-900 hover:bg-gray-800 text-white px-5 py-3 rounded-lg font-medium min-h-11"
              >
                Find
              </button>
            </div>
          </form>

          <div className="flex-1 flex flex-col min-h-[300px]">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Available Catalog ({variants.length})</h3>
            <div className="flex-1 overflow-y-auto border rounded-lg divide-y bg-gray-50 max-h-[450px]">
              {variants.length === 0 ? (
                <div className="p-6 text-center text-gray-400">No active products found in catalog.</div>
              ) : (
                variants
                  .filter(
                    (v) =>
                      !searchQuery ||
                      v.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      v.barcode?.includes(searchQuery) ||
                      v.sku?.toLowerCase().includes(searchQuery.toLowerCase()),
                  )
                  .map((v) => (
                    <button
                      key={v.id}
                      onClick={() => addToCartByVariantId(v.id)}
                      className="w-full text-left p-3 hover:bg-blue-50 transition-colors flex justify-between items-center min-h-11 bg-white"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-gray-900 text-sm truncate">
                          {v.product_name} <span className="text-gray-500 text-xs font-normal">({v.name})</span>
                        </div>
                        <div className="text-xs text-gray-500 flex gap-3 mt-0.5">
                          <span>Barcode: {v.barcode || 'None'}</span>
                          <span>Stock: {v.on_hand}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-blue-700 text-sm">
                          {formatMoney(v.sale_price, 0, currency)}
                        </span>
                      </div>
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Completed Sale Receipt Modal */}
      {completedResult && shop && (
        <ReceiptModal
          result={completedResult}
          shop={shop}
          onClose={() => {
            setCompletedResult(null);
            focusScan();
          }}
        />
      )}
    </div>
  );
}

