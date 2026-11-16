import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import { StockRepo, ShopRepo, ProductRepo, DeviceRepo } from '@vaporflow/core';
import type { Shop, StockMovement } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';

interface InventoryItem {
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_id: string;
  variant_name: string;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  sale_price: number;
  track_stock: number;
  on_hand: number;
  threshold: number;
}

export function StockScreen() {
  const db = useDb();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
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
    { variant_id: string; label: string; cost_price: number }[]
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

      const allVars = await productRepo.getVariants(activeShop.id);
      const allProds = await productRepo.getProducts(activeShop.id);
      const prodMap = new Map(allProds.map((p) => [p.id, p.name]));

      const list = allVars.map((v) => ({
        variant_id: v.id,
        label: `${prodMap.get(v.product_id) ?? 'Product'} — ${v.name} (${v.sku || v.barcode || 'No SKU'})`,
        cost_price: v.cost_price,
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

  function handleOpenStockIn() {
    setStockInItems([
      {
        variantId: allVariants[0]?.variant_id ?? '',
        variantLabel: allVariants[0]?.label ?? '',
        qty: '10',
        unitCost: '',
        note: 'Restock shipment',
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
        qty: '10',
        unitCost: '',
        note: 'Restock shipment',
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

  if (loading) {
    return (
      <div className="p-8 text-gray-600" role="status">
        Loading inventory...
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Stock & Inventory</h1>
          <p className="text-gray-600">Track on-hand stock, restock shipments, and perform adjustments.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleOpenStockIn}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg min-h-11 shadow"
          >
            + Stock In
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="p-4 bg-green-50 text-green-700 rounded-lg border border-green-200">
          {success}
        </div>
      )}

      {/* Filter Tabs and Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          {(['all', 'low', 'out', 'negative'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2 rounded-lg font-medium text-sm min-h-11 capitalize transition-colors ${
                filter === tab
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab === 'low' ? 'Low Stock' : tab === 'out' ? 'Out of Stock' : tab}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search inventory..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-80 px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b text-gray-700 text-sm">
                <th className="p-4 font-semibold">Product / Variant</th>
                <th className="p-4 font-semibold">SKU / Barcode</th>
                <th className="p-4 font-semibold">Price</th>
                <th className="p-4 font-semibold">On Hand</th>
                <th className="p-4 font-semibold">Status / Threshold</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {inventory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    No inventory items match the current filter.
                  </td>
                </tr>
              ) : (
                inventory.map((item) => {
                  const isOut = item.on_hand <= 0;
                  const isLow = item.on_hand <= item.threshold;
                  const isNegative = item.on_hand < 0;

                  return (
                    <tr key={item.variant_id} className="hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-semibold text-gray-900">{item.product_name}</div>
                        <div className="text-xs text-gray-600">{item.variant_name}</div>
                      </td>
                      <td className="p-4 text-gray-600">
                        <div>{item.sku || '—'}</div>
                        <div className="text-xs font-mono text-gray-400">{item.barcode || '—'}</div>
                      </td>
                      <td className="p-4 font-medium text-gray-800">PKR {item.sale_price}</td>
                      <td className="p-4">
                        <span
                          className={`text-base font-bold ${
                            isNegative
                              ? 'text-purple-600'
                              : isOut
                              ? 'text-red-600'
                              : isLow
                              ? 'text-amber-600'
                              : 'text-green-600'
                          }`}
                        >
                          {item.on_hand}
                        </span>
                      </td>
                      <td className="p-4">
                        {isNegative ? (
                          <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                            Negative
                          </span>
                        ) : isOut ? (
                          <span className="bg-red-50 text-red-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                            Low (≤ {item.threshold})
                          </span>
                        ) : (
                          <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                            Normal
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenAdjust(item)}
                          className="px-3 py-1.5 border rounded text-blue-600 hover:bg-blue-50 min-h-11 font-medium"
                        >
                          Adjust
                        </button>
                        <button
                          onClick={() => void handleOpenHistory(item)}
                          className="px-3 py-1.5 border rounded text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
                        >
                          History
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock In Modal */}
      {stockInOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-3xl w-full space-y-6 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b pb-4">
              <h2 className="text-2xl font-bold text-gray-900">Stock In (Restock)</h2>
              <button
                onClick={() => setStockInOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold px-3 py-1 min-h-11"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveStockIn} className="space-y-4">
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                {stockInItems.map((si, index) => (
                  <div key={index} className="p-4 bg-gray-50 border rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-gray-600">Item #{index + 1}</span>
                      {stockInItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setStockInItems((prev) => prev.filter((_, i) => i !== index))
                          }
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Variant</label>
                      <select
                        value={si.variantId}
                        onChange={(e) => {
                          const vId = e.target.value;
                          setStockInItems((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, variantId: vId } : item)),
                          );
                        }}
                        className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                      >
                        {allVariants.map((v) => (
                          <option key={v.variant_id} value={v.variant_id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
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
                          className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          New Purchase Price (Optional)
                        </label>
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
                          className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Note</label>
                        <input
                          type="text"
                          value={si.note}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStockInItems((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, note: val } : item)),
                            );
                          }}
                          className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
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
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium min-h-11 w-full"
              >
                + Add Another Item
              </button>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setStockInOpen(false)}
                  className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg min-h-11 font-medium shadow"
                >
                  Complete Stock In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Stock Adjustment (Recount)</h3>
            <p className="text-sm text-gray-600">
              Current on hand: <strong className="text-gray-900">{selectedVariantOnHand}</strong>
            </p>

            <form onSubmit={handleSaveAdjustment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Counted Quantity *</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={adjustCountedQty}
                  onChange={(e) => setAdjustCountedQty(e.target.value)}
                  className="w-full px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Note (Required) *</label>
                <textarea
                  required
                  rows={3}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="e.g. Broken items found during monthly recount"
                  className="w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustOpen(false)}
                  className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg min-h-11 font-medium"
                >
                  Save Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-3xl w-full space-y-4 shadow-2xl my-8 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Stock History</h3>
                <p className="text-sm text-gray-600">{historyVariantName}</p>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold px-3 py-1 min-h-11"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {historyMovements.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No movement history found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b text-gray-700">
                        <th className="p-3">Type</th>
                        <th className="p-3">Change</th>
                        <th className="p-3">Unit Cost</th>
                        <th className="p-3">Note</th>
                        <th className="p-3">Occurred At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {historyMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="p-3 font-semibold capitalize text-gray-800">{m.type}</td>
                          <td className="p-3">
                            <span
                              className={`font-bold ${
                                m.qty_change > 0 ? 'text-green-600' : 'text-red-600'
                              }`}
                            >
                              {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                            </span>
                          </td>
                          <td className="p-3 text-gray-600">
                            {m.unit_cost !== null ? `PKR ${m.unit_cost}` : '—'}
                          </td>
                          <td className="p-3 text-gray-600">{m.note || '—'}</td>
                          <td className="p-3 text-xs text-gray-500">
                            {new Date(m.occurred_at).toLocaleString()}
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
