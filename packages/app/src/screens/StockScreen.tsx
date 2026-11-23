import { useRecordWindow } from '../utils/use-record-window';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import { StockRepo, ShopRepo, ProductRepo, DeviceRepo, formatMoney } from '@vaporflow/core';
import type { Shop, StockMovement } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';
import { registerBackHandler } from '../utils/back-nav';
import { CameraScanButton } from '../components/ScanControls';

interface InventoryItem {
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_id: string;
  variant_name: string;
  sku: string | null;
  barcode: string | null;
  category_name: string;
  cost_price: number;
  sale_price: number;
  track_stock: number;
  on_hand: number;
  threshold: number;
}

interface InventoryCounts {
  all: number;
  low: number;
  out: number;
  negative: number;
}

export function StockScreen() {
  const db = useDb();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [counts, setCounts] = useState<InventoryCounts>({ all: 0, low: 0, out: 0, negative: 0 });
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'negative'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Stock In Modal State
  const [stockInOpen, setStockInOpen] = useState(false);
  const [stockInItems, setStockInItems] = useState<
    { variantId: string; variantLabel: string; qty: string; unitCost: string; note: string }[]
  >([]);
  const [allVariants, setAllVariants] = useState<
    { variant_id: string; label: string; cost_price: number; barcode: string | null }[]
  >([]);

  // Adjustment Modal State
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustVariantId, setAdjustVariantId] = useState('');
  const [adjustCountedQty, setAdjustCountedQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [selectedVariantOnHand, setSelectedVariantOnHand] = useState(0);

  // History Modal State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVariantName, setHistoryVariantName] = useState('');
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([]);

  const loadData = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const stockRepo = new StockRepo(db);
      const productRepo = new ProductRepo(db);

      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);
      setDeviceId((await new DeviceRepo(db).getActiveDevice(activeShop.id))?.id ?? null);

      const items = await stockRepo.getInventoryList(activeShop.id, filter, search);
      setInventory(items);
      setCounts(await stockRepo.getInventoryCounts(activeShop.id));

      const allVars = await productRepo.getVariants(activeShop.id);
      const allProds = await productRepo.getProducts(activeShop.id);
      const prodMap = new Map(allProds.map((p) => [p.id, p.name]));

      const list = allVars.map((v) => ({
        variant_id: v.id,
        label: `${prodMap.get(v.product_id) ?? 'Product'} — ${v.name} (${v.sku || v.barcode || 'No SKU'})`,
        cost_price: v.cost_price,
        barcode: v.barcode ?? null,
      }));
      setAllVariants(list);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [db, filter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Android back button: close the topmost stock modal first.
  useEffect(() => {
    if (!stockInOpen && !adjustOpen && !historyOpen) return;
    return registerBackHandler(() => {
      if (historyOpen) setHistoryOpen(false);
      else if (adjustOpen) setAdjustOpen(false);
      else setStockInOpen(false);
      return true;
    });
  }, [stockInOpen, adjustOpen, historyOpen]);

  // Camera scan in Stock In: match the scanned barcode to a variant row.
  const handleStockInScan = useCallback((index: number, code: string) => {
    const match = allVariants.find(
      (v) => v.barcode === code,
    );
    if (!match) {
      setError(`No product variant found for barcode "${code}".`);
      return;
    }
    setError('');
    setStockInItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, variantId: match.variant_id, variantLabel: match.label } : item,
      ),
    );
  }, [allVariants]);

  function handleOpenStockIn(variantId?: string) {
    const selected = allVariants.find(v => v.variant_id === variantId) ?? allVariants[0];
    setStockInItems([
      {
        variantId: selected?.variant_id ?? '',
        variantLabel: selected?.label ?? '',
        qty: '',
        unitCost: '',
        note: '',
      },
    ]);
    setError('');
    setSuccess('');
    setStockInOpen(true);
  }

  function handleAddStockInRow() {
    const first = allVariants[0];
    if (!first) return;
    setStockInItems((prev) => [
      ...prev,
      {
        variantId: first.variant_id,
        variantLabel: first.label,
        qty: '',
        unitCost: '',
        note: '',
      },
    ]);
  }

  async function handleSaveStockIn(e: React.FormEvent) {
    e.preventDefault();
    if (!shop || savingRef.current) return;
    if (!deviceId) { setError('No active device registered.'); return; }
    setError('');
    setSuccess('');

    if (stockInItems.length === 0) {
      setError('Add at least one item.');
      return;
    }

    const parsedItems: { variantId: string; qty: number; unitCost?: number; note?: string }[] = [];
    for (const [index, item] of stockInItems.entries()) {
      const row = index + 1;
      const qty = parseInt(item.qty, 10);
      if (isNaN(qty) || qty <= 0 || !/^\d+$/.test(item.qty.trim())) {
        setError(`Item #${row}: quantity must be a positive whole number.`);
        return;
      }
      if (item.variantId === '') {
        setError(`Item #${row}: select a variant.`);
        return;
      }
      let unitCost: number | undefined;
      if (item.unitCost.trim() !== '') {
        unitCost = parseInt(item.unitCost, 10);
        if (isNaN(unitCost) || unitCost < 0 || !/^\d+$/.test(item.unitCost.trim())) {
          setError(`Item #${row}: purchase price must be a non-negative whole number, or left empty.`);
          return;
        }
      }
      parsedItems.push({
        variantId: item.variantId,
        qty,
        unitCost,
        note: item.note.trim() || undefined,
      });
    }

    try {
      savingRef.current = true;
      const stockRepo = new StockRepo(db);
      const now = new Date().toISOString();
      await stockRepo.stockIn(shop.id, parsedItems, deviceId, now);
      notifyStockChanged();
      setSuccess(`Stock In recorded: ${parsedItems.length} item${parsedItems.length === 1 ? '' : 's'}.`);
      setStockInOpen(false);
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to record stock in');
    } finally { savingRef.current = false; }
  }

  function handleOpenAdjust(item: InventoryItem) {
    setAdjustVariantId(item.variant_id);
    setSelectedVariantOnHand(item.on_hand);
    setAdjustCountedQty(item.on_hand.toString());
    setAdjustNote('');
    setError('');
    setSuccess('');
    setAdjustOpen(true);
  }

  async function handleSaveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!shop || savingRef.current) return;
    if (!deviceId) { setError('No active device registered.'); return; }
    setError('');
    setSuccess('');

    if (!adjustNote.trim()) {
      setError('Adjustment note is required.');
      return;
    }

    try {
      savingRef.current = true;
      const stockRepo = new StockRepo(db);
      const now = new Date().toISOString();
      const counted = parseInt(adjustCountedQty, 10);
      if (isNaN(counted) || counted < 0 || !/^\d+$/.test(adjustCountedQty.trim())) {
        throw new Error('Counted quantity must be a non-negative whole number.');
      }

      await stockRepo.adjustStock(shop.id, adjustVariantId, counted, adjustNote.trim(), deviceId, now);
      notifyStockChanged();
      setSuccess('Stock adjustment recorded successfully.');
      setAdjustOpen(false);
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to record adjustment');
    } finally { savingRef.current = false; }
  }

  async function handleOpenHistory(item: InventoryItem) {
    if (!shop) return;
    try {
      const stockRepo = new StockRepo(db);
      const movements = await stockRepo.getMovementsForVariant(shop.id, item.variant_id);
      setHistoryVariantName(`${item.product_name} — ${item.variant_name}`);
      setHistoryMovements(movements);
      setHistoryOpen(true);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load stock history');
    }
  }

  useEffect(() => {
    const scan = (event: Event) => {
      const target = document.activeElement;
      const code: unknown = (event as CustomEvent<unknown>).detail;
      if (target instanceof HTMLSelectElement && target.dataset.stockScan && typeof code === 'string') {
        handleStockInScan(Number(target.dataset.stockScan), code);
      }
    };
    window.addEventListener('vf-barcode', scan);
    return () => window.removeEventListener('vf-barcode', scan);
  }, [handleStockInScan]);
  const recordWindow = useRecordWindow(inventory);
  if (loading) {
    return (
      <div className="vf-page text-sm text-slate-500" role="status">
        Loading inventory…
      </div>
    );
  }

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;

  const filterChips: { id: typeof filter; label: string; count: number }[] = [
    { id: 'all', label: 'All Variants', count: counts.all },
    { id: 'low', label: 'Low Stock', count: counts.low },
    { id: 'out', label: 'Out of Stock', count: counts.out },
    { id: 'negative', label: 'Negative', count: counts.negative },
  ];

  return (
    <div className="vf-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vf-sub max-w-xl">
          On-hand quantities, purchase prices and the stock ledger for every variant.
        </p>
        <button onClick={() => handleOpenStockIn()} className="vf-btn-primary">
          + Stock In
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {success}
        </div>
      )}

      {/* Filter chips and search */}
      <div className="vf-card flex flex-col justify-between gap-3 p-4 md:flex-row md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
              className="vf-chip min-h-10"
            >
              <span>{chip.label}</span>
              <span className="vf-num rounded-full bg-white px-1.5 py-0.5 text-[11px] text-slate-700">
                {chip.count}
              </span>
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter stock items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="vf-input w-full md:w-72"
          aria-label="Filter stock items"
        />
      </div>

      {/* Inventory table */}
      <div className="vf-card overflow-hidden">
        <div className="overflow-x-auto" ref={recordWindow.viewport} style={recordWindow.viewportStyle}>
          <div style={recordWindow.padding}>
          <table className="record-list vf-table">
            <thead>
              <tr>
                <th>Item / Variant</th>
                <th>SKU / Barcode</th>
                <th className="text-right">Purchase</th>
                <th className="text-right">Sale Price</th>
                <th className="text-right">On Hand</th>
                <th className="text-center">Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {inventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No inventory items match the current filter.
                  </td>
                </tr>
              ) : (
                recordWindow.visible.map((item, i) => {
                  const isOut = item.on_hand <= 0;
                  const isLow = item.on_hand > 0 && item.on_hand <= item.threshold;
                  const isNegative = item.on_hand < 0;

                  return (
                    <tr key={item.variant_id} ref={recordWindow.measure} data-index={recordWindow.start + i}>
                      <td data-label="Item / Variant">
                        <div className="font-semibold text-slate-900">
                          {item.variant_name === 'Default'
                            ? item.product_name
                            : `${item.product_name} — ${item.variant_name}`}
                        </div>
                        <div className="text-xs text-slate-500">{item.category_name}</div>
                      </td>
                      <td data-label="SKU / Barcode" className="text-xs text-slate-600">
                        <div>{item.sku || '—'}</div>
                        <div className="vf-num text-[11px] text-slate-400">
                          {item.barcode || '—'}
                        </div>
                      </td>
                      <td
                        data-label="Purchase"
                        className="vf-num whitespace-nowrap text-right text-slate-700"
                      >
                        {formatMoney(item.cost_price, decimals, currency)}
                      </td>
                      <td
                        data-label="Sale Price"
                        className="vf-num whitespace-nowrap text-right font-semibold text-slate-900"
                      >
                        {formatMoney(item.sale_price, decimals, currency)}
                      </td>
                      <td
                        data-label="On Hand"
                        className={`vf-num text-right text-base font-bold ${
                          isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'
                        }`}
                      >
                        {item.on_hand}
                      </td>
                      <td data-label="Status" className="text-center">
                        {isNegative ? (
                          <span className="vf-badge-rose bg-purple-50 text-purple-800">
                            Negative ({item.on_hand})
                          </span>
                        ) : isOut ? (
                          <span className="vf-badge-rose">Out of Stock</span>
                        ) : isLow ? (
                          <span className="vf-badge-amber">Low (≤ {item.threshold})</span>
                        ) : (
                          <span className="vf-badge-green">Healthy</span>
                        )}
                      </td>
                      <td data-label="Actions" className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            className="vf-btn-ghost min-h-9 px-3 text-xs text-emerald-800"
                            onClick={() => handleOpenStockIn(item.variant_id)}
                          >
                            + Stock In
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenAdjust(item)}
                            className="vf-btn-ghost min-h-9 px-3 text-xs"
                          >
                            Adjust
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOpenHistory(item)}
                            className="vf-btn-ghost min-h-9 px-2.5 text-xs"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Stock In Modal */}
      {stockInOpen && (
        <div className="vf-modal overflow-y-auto">
          <div className="vf-modal-card max-w-3xl space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 className="text-xl font-bold text-slate-900">Stock In (Restock)</h2>
              <button
                onClick={() => setStockInOpen(false)}
                className="icon-button text-xl font-bold"
                aria-label="Close stock in"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveStockIn} className="space-y-4">
              <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-2">
                {stockInItems.map((si, index) => (
                  <div
                    key={index}
                    className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">
                        Item #{index + 1}
                      </span>
                      {stockInItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setStockInItems((prev) => prev.filter((_, i) => i !== index))
                          }
                          className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="vf-label">Variant</label>
                      <div className="flex gap-2">
                        <select
                          data-stock-scan={index}
                          value={si.variantId}
                          onChange={(e) => {
                            const vId = e.target.value;
                            setStockInItems((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, variantId: vId } : item)),
                            );
                          }}
                          className="vf-select min-w-0 flex-1"
                        >
                          {allVariants.map((v) => (
                            <option key={v.variant_id} value={v.variant_id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                        <CameraScanButton
                          onError={setError}
                          onScan={(code) => handleStockInScan(index, code)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <label className="vf-label">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          required
                          value={si.qty}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStockInItems((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, qty: val } : item)),
                            );
                          }}
                          className="vf-input"
                        />
                      </div>
                      <div>
                        <label className="vf-label">New Purchase Price (Optional)</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Leave empty to keep current"
                          value={si.unitCost}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStockInItems((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, unitCost: val } : item)),
                            );
                          }}
                          className="vf-input"
                        />
                      </div>
                      <div>
                        <label className="vf-label">Note</label>
                        <input
                          type="text"
                          value={si.note}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStockInItems((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, note: val } : item)),
                            );
                          }}
                          className="vf-input"
                          placeholder="Supplier / delivery note"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAddStockInRow}
                className="vf-btn-ghost w-full"
              >
                + Add Another Item
              </button>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setStockInOpen(false)}
                  className="vf-btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="vf-btn-primary">
                  Complete Stock In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustOpen && (
        <div className="vf-modal">
          <div className="vf-modal-card max-w-md space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Stock Adjustment (Recount)</h3>
              <button
                onClick={() => setAdjustOpen(false)}
                className="icon-button text-xl font-bold"
                aria-label="Close stock adjustment"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Current on hand: <strong className="text-slate-900">{selectedVariantOnHand}</strong>
            </p>

            <form onSubmit={handleSaveAdjustment} className="space-y-4">
              <div>
                <label className="vf-label" htmlFor="adjust-counted">
                  Counted Quantity *
                </label>
                <input
                  id="adjust-counted"
                  type="number"
                  min="0"
                  required
                  value={adjustCountedQty}
                  onChange={(e) => setAdjustCountedQty(e.target.value)}
                  className="vf-input"
                />
              </div>
              <div>
                <label className="vf-label" htmlFor="adjust-note">
                  Reason / Note (Required) *
                </label>
                <textarea
                  id="adjust-note"
                  required
                  rows={3}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="e.g. Broken items found during monthly recount"
                  className="vf-textarea"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustOpen(false)}
                  className="vf-btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="vf-btn-primary">
                  Save Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock History Modal */}
      {historyOpen && (
        <div className="vf-modal overflow-y-auto">
          <div className="vf-modal-card max-h-[80vh] max-w-3xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Stock History</h3>
                <p className="text-sm text-slate-600">{historyVariantName}</p>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="icon-button text-xl font-bold"
                aria-label="Close stock history"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {historyMovements.length === 0 ? (
                <p className="py-6 text-center text-slate-500">No movement history found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="vf-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Change</th>
                        <th>Unit Cost</th>
                        <th>Note</th>
                        <th>Occurred At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyMovements.map((m) => (
                        <tr key={m.id}>
                          <td className="font-semibold capitalize text-slate-800">{m.type}</td>
                          <td>
                            <span
                              className={`vf-num font-bold ${
                                m.qty_change > 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                            </span>
                          </td>
                          <td className="vf-num text-slate-600">
                            {m.unit_cost !== null ? formatMoney(m.unit_cost, decimals, currency) : '—'}
                          </td>
                          <td className="text-slate-600">{m.note || '—'}</td>
                          <td className="text-xs text-slate-500">
                            {new Date(m.occurred_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
