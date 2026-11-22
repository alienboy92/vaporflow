import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb, usePlatform } from '../context/DbProvider';
import {
  ProductRepo,
  CategoryRepo,
  StockRepo,
  SaleRepo,
  ShopRepo,
  DeviceRepo,
  uuidv7,
  formatMoney,
  roundRatio,
} from '@vaporflow/core';
import type { Shop, Category, Variant, Sale, SaleItem } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';
import {
  setSaleCartActive,
  registerBackHandler,
  setSaleAbandonHandler,
  clearSaleAbandonHandler,
} from '../utils/back-nav';
import { CameraScanButton, WedgeToggle, useWedgeMode } from '../components/ScanControls';
import { useCloudSync } from '../context/CloudSyncProvider';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { ReceiptModal } from '../components/ReceiptModal';
import { useToast } from '../components/Toast';

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

export function useSaleDraft() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [amountReceivedInput, setAmountReceivedInput] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('0');
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [note, setNote] = useState('');
  return { cart, setCart, paymentMethod, setPaymentMethod, amountReceivedInput, setAmountReceivedInput, discountMode, setDiscountMode, discountInput, setDiscountInput, discountPercentInput, setDiscountPercentInput, note, setNote };
}

export function SaleScreen({ draft }: { draft: ReturnType<typeof useSaleDraft> }) {
  const { cart, setCart, paymentMethod, setPaymentMethod, amountReceivedInput, setAmountReceivedInput, discountMode, setDiscountMode, discountInput, setDiscountInput, discountPercentInput, setDiscountPercentInput, note, setNote } = draft;
  const db = useDb();
  const platform = usePlatform();
  const toast = useToast();
  const saleCompleted = useCloudSync().saleCompleted;
  const [wedge, toggleWedge] = useWedgeMode();
  const navigate = useNavigate();
  const [shop, setShop] = useState<Shop | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [variants, setVariants] = useState<
    (Variant & { product_name: string; category_id: string | null; on_hand: number })[]
  >([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  // Scanned value with no matching product; enables the create-product offer.
  const [notFoundQuery, setNotFoundQuery] = useState('');

  // Completed receipt modal state
  const [completedResult, setCompletedResult] = useState<{ sale: Sale; items: SaleItem[] } | null>(
    null,
  );

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

      const prodMap = new Map(allProds.map((p) => [p.id, p]));
      setCategories(await new CategoryRepo(db).getAll(activeShop.id));

      const list = allVars
        .filter((v) => v.is_active === 1)
        .map((v) => ({
          ...v,
          product_name: prodMap.get(v.product_id)?.name ?? 'Product',
          category_id: prodMap.get(v.product_id)?.category_id ?? null,
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
  const addToCartByVariantId = useCallback(
    (variantId: string) => {
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
    },
    [variants, focusScan, setCart],
  );

  // Totals for the current cart; shared by the summary display and completion.
  const computeTotals = useCallback(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0);
    const percent = Math.min(100, Math.max(0, parseInt(discountPercentInput || '0', 10)));
    // Integer-safe percent conversion using core roundRatio (half rounds up).
    const percentDiscount = Number(roundRatio(BigInt(subtotal) * BigInt(percent), 100n));
    const rawDiscount =
      discountMode === 'amount' ? Math.max(0, parseInt(discountInput || '0', 10)) : percentDiscount;
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
      const amountReceived =
        paymentMethod === 'cash' ? parseInt(amountReceivedInput || '0', 10) : totals.total;

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
      setCartOpen(false);
      setCompletedResult(result);
      toast.show('Sale completed');
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
  }, [
    shop,
    deviceId,
    cart,
    paymentMethod,
    amountReceivedInput,
    note,
    db,
    setAmountReceivedInput, setCart, setDiscountInput, setDiscountPercentInput, setNote,
    computeTotals,
    loadCatalog,
    saleCompleted,
    toast,
  ]);

  // Keyboard shortcuts: F2 (focus scan), F9 (complete sale), Esc (clear cart)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (document.querySelector('dialog[open]') && !cartOpen) return;
      if (completedResult || (cartOpen && e.key !== 'F9')) return;
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
  }, [cart, completedResult, cartOpen, focusScan, handleCompleteSale, setCart]);

  useEffect(() => {
    focusScan();
  }, [focusScan]);

  // Handle barcode scan / search submit (shared by the form and the camera scan).
  function handleScanQuery(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;

    // Check exact barcode match
    const matchedBarcode = variants.find((v) => v.barcode?.toLowerCase() === trimmed.toLowerCase());
    if (matchedBarcode) {
      addToCartByVariantId(matchedBarcode.id);
      return;
    }

    // Check exact SKU match
    const matchedSku = variants.find((v) => v.sku?.toLowerCase() === trimmed.toLowerCase());
    if (matchedSku) {
      addToCartByVariantId(matchedSku.id);
      return;
    }

    // If query matches single variant name/product name uniquely
    const matches = variants.filter(
      (v) =>
        v.product_name.toLowerCase().includes(trimmed.toLowerCase()) ||
        v.name.toLowerCase().includes(trimmed.toLowerCase()) ||
        v.barcode?.includes(trimmed) ||
        v.sku?.toLowerCase().includes(trimmed.toLowerCase()),
    );

    if (matches.length === 1) {
      addToCartByVariantId(matches[0]!.id);
    } else if (matches.length === 0) {
      setNotFoundQuery(trimmed);
      setError(`No product found matching "${trimmed}".`);
      setTimeout(() => {
        setError('');
        setNotFoundQuery('');
      }, 8000);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleScanQuery(searchQuery);
  }

  // Android back button: close the receipt modal first; flag the cart so the
  // Shell can confirm before abandoning an in-progress sale.
  useEffect(() => {
    if (!completedResult) return;
    return registerBackHandler(() => {
      setCompletedResult(null);
      return true;
    });
  }, [completedResult]);

  useEffect(() => {
    setSaleCartActive(cart.length > 0);
    return () => setSaleCartActive(false);
  }, [cart.length]);

  // The Back-button confirm's "cart will be cleared" promise: the Shell calls
  // this handler after the user confirms abandoning the sale.
  useEffect(() => {
    setSaleAbandonHandler(() => setCart([]));
    return () => clearSaleAbandonHandler();
  }, [setCart]);

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
  const amountReceived =
    paymentMethod === 'cash' ? parseInt(amountReceivedInput || '0', 10) : total;
  const changeDue = Math.max(0, amountReceived - total);
  // Non-blocking warning: completing a cash sale short still succeeds on
  // purpose (no data blocking), but the cashier must see it before F9.
  const cashShort =
    paymentMethod === 'cash' && amountReceivedInput !== '' && amountReceived < total;

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;

  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const query = searchQuery.trim().toLowerCase();
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const pickedQuantities = new Map(cart.map((line) => [line.variant_id, line.qty]));
  const [page, setPage] = useState(0);
  const pageSize = 48;
  const matches = React.useMemo(() => variants.filter(
    (v) =>
      (!category || v.category_id === category) &&
      [v.product_name, v.name, v.barcode, v.sku].some((field) =>
        field?.toLowerCase().includes(query),
      ),
  ), [variants, query, category]);
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleVariants = matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => setPage(0), [query, category]);
  if (loading) {
    return <div className="vf-page text-sm text-slate-500">Loading checkout…</div>;
  }

  const checkout = (
    <div className="checkout-body">
      <div>
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Icon name="shoppingCart" />
            Current Cart{' '}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{itemCount}</span>
          </h2>
          {cart.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Clear cart?')) setCart([]);
              }}
              className="flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 hover:text-rose-800"
            >
              Clear (Esc)
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p className="text-base font-medium">Cart is empty</p>
            <p className="text-sm">Scan a barcode or tap a product to start a sale.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {cart.map((item, index) => {
              const lineTotal = item.unit_price * item.qty;
              const isNegativeStock = item.on_hand - item.qty < 0;
              return (
                <div
                  key={item.variant_id}
                  className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {item.product_name}{' '}
                      <span className="font-normal text-slate-500">({item.variant_name})</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <span>Price:</span>
                        <input
                          type="number"
                          min="0"
                          value={item.unit_price}
                          onChange={(e) => updatePrice(index, parseInt(e.target.value || '0', 10))}
                          className="vf-input w-24 px-1.5 py-0.5 text-xs"
                          title="Click to override price"
                        />
                        {item.unit_price !== item.list_price && (
                          <span className="vf-num text-[11px] text-slate-400 line-through">
                            {formatMoney(item.list_price, decimals, currency)}
                          </span>
                        )}
                      </div>
                      <span>Stock: {item.on_hand}</span>
                      {isNegativeStock && (
                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                          Below stock (negative allowed)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full items-center justify-between gap-3">
                    {/* Qty controls */}
                    <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                      <button
                        onClick={() => updateQty(index, item.qty - 1)}
                        className="flex min-h-11 min-w-11 items-center justify-center px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-100"
                        aria-label="Decrease quantity"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        aria-label={`Quantity for ${item.product_name} ${item.variant_name}`}
                        value={item.qty}
                        onChange={(e) => updateQty(index, parseInt(e.target.value || '1', 10))}
                        className="vf-num w-12 border-x border-slate-200 py-1.5 text-center text-sm focus:outline-none"
                      />
                      <button
                        onClick={() => updateQty(index, item.qty + 1)}
                        className="flex min-h-11 min-w-11 items-center justify-center px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-100"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <div className="vf-num flex-1 text-right font-bold text-slate-900">
                      {formatMoney(lineTotal, decimals, currency)}
                    </div>

                    <button
                      onClick={() => removeItem(index)}
                      className="flex min-h-11 min-w-11 items-center justify-center p-2 font-bold text-rose-500 hover:text-rose-700"
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
      <div className="space-y-4 border-t border-slate-200 pt-4">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="vf-num">{formatMoney(subtotal, decimals, currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-600">
            {discountMode === 'amount' ? (
              <span>Discount ({currency})</span>
            ) : (
              <span>Discount (%)</span>
            )}
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setDiscountMode('amount')}
                  className={`min-h-11 px-3 py-1 text-xs font-medium ${
                    discountMode === 'amount'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  aria-pressed={discountMode === 'amount'}
                >
                  {currency}
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountMode('percent')}
                  className={`min-h-11 px-3 py-1 text-xs font-medium ${
                    discountMode === 'percent'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                  className="vf-input vf-num w-28 py-1 text-right"
                  aria-label="Discount amount"
                />
              ) : (
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={discountPercentInput}
                  onChange={(e) => setDiscountPercentInput(e.target.value)}
                  className="vf-input vf-num w-28 py-1 text-right"
                  aria-label="Discount percent"
                />
              )}
            </div>
          </div>
          {discountExceedsSubtotal && (
            <div role="alert" className="text-xs text-rose-600">
              Discount cannot exceed the subtotal.
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold text-slate-900">
            <span>Total</span>
            <span className="vf-num">{formatMoney(total, decimals, currency)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPaymentMethod('cash')}
            className={`min-h-11 rounded-xl border py-3 text-center text-sm font-semibold transition-colors ${
              paymentMethod === 'cash'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Cash Payment
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod('online')}
            className={`min-h-11 rounded-xl border py-3 text-center text-sm font-semibold transition-colors ${
              paymentMethod === 'online'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Online / Card
          </button>
        </div>

        {paymentMethod === 'cash' && (
          <div className="grid grid-cols-2 items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div>
              <label className="vf-label">
                Cash Received ({currency})
              </label>
              <input
                type="number"
                min={total}
                value={amountReceivedInput}
                onChange={(e) => setAmountReceivedInput(e.target.value)}
                placeholder={total.toString()}
                className="vf-input vf-num"
              />
            </div>
            <div className="text-right">
              <span className="vf-label">Change Due</span>
              <span className="vf-num text-xl font-bold text-emerald-700">
                {formatMoney(changeDue, decimals, currency)}
              </span>
            </div>
          </div>
        )}

        {cashShort && (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            Cash received is less than the total. The sale can still complete, but the customer
            still owes the difference.
          </div>
        )}

        <div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional sale note or customer reference..."
            className="vf-input"
          />
        </div>

        <button
          disabled={completing || cart.length === 0 || discountExceedsSubtotal}
          onClick={() => void handleCompleteSale()}
          className="vf-btn-primary min-h-12 w-full text-base font-bold"
        >
          {completing
            ? 'Completing Sale…'
            : `Complete Sale (F9) — ${formatMoney(total, decimals, currency)}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="sale-layout">
      <section className="min-w-0" aria-label="Product catalog">
        <div className="catalog-tools">
          <form onSubmit={handleSearchSubmit} className="scan-panel">
            <label htmlFor="barcode-scan" className="sr-only">
              Barcode / SKU / Name Scan (F2)
            </label>
            <div className="scanner-row">
              <span className="scan-symbol">
                <Icon name="barcode" />
              </span>
              <input
                id="barcode-scan"
                ref={scanInputRef}
                type="text"
                inputMode={platform.platform === 'android' && wedge ? 'none' : 'text'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  wedge ? 'Wedge mode: scan with OTG scanner…' : 'Scan barcode or type name...'
                }
                className="flex-1 border-2 rounded-xl pl-10 pr-2 py-2 text-base focus:ring-2 focus:ring-emerald-500 focus:outline-none min-w-0"
                autoComplete="off"
                autoFocus
              />
              {platform.platform === 'android' && (
                <WedgeToggle
                  compact
                  wedge={wedge}
                  onToggle={() => {
                    toggleWedge();
                    focusScan();
                  }}
                />
              )}
              {platform.platform === 'android' && (
                <CameraScanButton
                  onError={setError}
                  onScan={(code) => {
                    setSearchQuery(code);
                    handleScanQuery(code);
                    focusScan();
                  }}
                />
              )}
              {platform.platform === 'desktop' && (
                <button
                  type="submit"
                  className="vf-btn-dark min-h-11 px-5 py-3"
                >
                  Find
                </button>
              )}
            </div>
          </form>
          <div className="category-chips" aria-label="Filter by category">
            <button
              aria-pressed={!category}
              onClick={() => {
                setCategory('');
                focusScan();
              }}
            >
              All ({variants.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                aria-pressed={category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  focusScan();
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
          >
            <span>{error}</span>
            {notFoundQuery && (
              <button
                onClick={handleCreateFromScan}
                className="min-h-11 rounded-lg bg-rose-700 px-3 py-1.5 font-medium text-white hover:bg-rose-800"
              >
                Create product with this barcode
              </button>
            )}
          </div>
        )}
        <div className="quick-grid">
          {visibleVariants.map((v) => {
            const qty = pickedQuantities.get(v.id);
            const low =
              v.on_hand <= (v.low_stock_threshold ?? shop?.default_low_stock_threshold ?? 0);
            return (
              <button
                className="pick-card"
                data-selected={Boolean(qty)}
                key={v.id}
                onClick={() => addToCartByVariantId(v.id)}
              >
                {qty && (
                  <b key={qty} className="pick-qty" aria-label={qty + ' in cart'}>
                    {qty}
                  </b>
                )}
                <span className="pick-meta">
                  <span>{categoryNames.get(v.category_id ?? '') ?? 'Uncategorized'}</span>
                  <small className={v.on_hand <= 0 ? 'out' : low ? 'low' : ''}>
                    {v.on_hand <= 0 ? 'OUT' : low ? 'LOW (' + v.on_hand + ')' : v.on_hand + ' left'}
                  </small>
                </span>
                <strong>
                  {v.product_name} · {v.name}
                </strong>
                <span className="pick-price">
                  {formatMoney(v.sale_price, decimals, currency)}
                  <small>{v.barcode?.slice(-4)}</small>
                </span>
              </button>
            );
          })}
          {!visibleVariants.length && (
            <p className="catalog-empty">
              {variants.length ? 'No matching products.' : 'No active products in your catalog.'}
            </p>
          )}
        </div>
        {lastPage > 0 && <nav aria-label="Catalog pages" className="flex items-center justify-center gap-4">
          <button className="vf-btn-ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {lastPage + 1}</span>
          <button className="vf-btn-ghost" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>}
      </section>
      <aside className="desktop-checkout">{checkout}</aside>
      <button className="cart-dock" data-filled={itemCount > 0} onClick={() => setCartOpen(true)}>
        <Icon name="shoppingCart" />
        <span>
          <strong>{itemCount ? 'View Cart & Checkout' : 'Cart Empty'}</strong>
          <small>
            {itemCount
              ? itemCount + (itemCount === 1 ? ' item' : ' items') + ' · Tap to pay'
              : 'Scan or tap items above'}
          </small>
        </span>
        <b>{formatMoney(total, decimals, currency)}</b>
      </button>
      {cartOpen && (
        <Sheet title="Checkout" onClose={() => setCartOpen(false)}>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          {checkout}
        </Sheet>
      )}
      {/* Completed Sale Receipt Modal */}
      {completedResult && shop && (
        <ReceiptModal
          newSale
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
