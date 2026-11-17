import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import {
  ShopRepo,
  SaleRepo,
  ReturnRepo,
  DeviceRepo,
  uuidv7,
  formatMoney,
  localDate,
} from '@vaporflow/core';
import type { Shop, Sale, SaleItem, Return, ReturnItem } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';
import { registerBackHandler } from '../utils/back-nav';
import { ReturnReceiptModal } from '../components/ReturnReceiptModal';
import type { ReturnReceipt } from '../utils/return-receipt';
import { ReceiptModal } from '../components/ReceiptModal';

export function SalesScreen() {
  const db = useDb();
  const [returnReceipt, setReturnReceipt] = useState<ReturnReceipt | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [returnsMap, setReturnsMap] = useState<Map<string, Return[]>>(new Map());
  const [returnItemsMap, setReturnItemsMap] = useState<Map<string, ReturnItem[]>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Selected sale for receipt viewing / reprinting
  const [selectedSaleResult, setSelectedSaleResult] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);

  // Return modal state
  const [returningSale, setReturningSale] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnRestocked, setReturnRestocked] = useState<Record<string, boolean>>({});
  const [refundMethod, setRefundMethod] = useState<'cash' | 'online'>('cash');
  const [returnNote, setReturnNote] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  // Errors surfaced INSIDE the return modal: the page-level error banner sits
  // behind the fixed modal overlay and would never be seen by the cashier.
  const [returnError, setReturnError] = useState('');
  const returnSubmittingRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const saleRepo = new SaleRepo(db);
      const deviceRepo = new DeviceRepo(db);

      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);

      const device = await deviceRepo.getActiveDevice(activeShop.id);
      setDeviceId(device?.id ?? null);

      const allSales = await saleRepo.getSales(activeShop.id);
      setSales(allSales);

      // Load returns and return items through the repository (zod-validated).
      const returnRepo = new ReturnRepo(db);
      const returnsList = await returnRepo.getReturns(activeShop.id);
      const returnItemsList = await returnRepo.getReturnItems(activeShop.id);

      const rMap = new Map<string, Return[]>();
      for (const ret of returnsList) {
        const list = rMap.get(ret.sale_id) || [];
        list.push(ret);
        rMap.set(ret.sale_id, list);
      }
      setReturnsMap(rMap);

      const riMap = new Map<string, ReturnItem[]>();
      for (const rit of returnItemsList) {
        const list = riMap.get(rit.sale_item_id) || [];
        list.push(rit);
        riMap.set(rit.sale_item_id, list);
      }
      setReturnItemsMap(riMap);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load sales history');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Android back button: close the topmost receipt/return modal first. The
  // return-form panel is inline state, not a stacked dialog, so only modals
  // register here.
  useEffect(() => {
    const modalOpen = returnReceipt !== null || selectedSaleResult !== null;
    if (!modalOpen) return;
    return registerBackHandler(() => {
      if (returnReceipt) setReturnReceipt(null);
      else setSelectedSaleResult(null);
      return true;
    });
  }, [returnReceipt, selectedSaleResult]);

  async function handleViewReceipt(sale: Sale) {
    try {
      const saleRepo = new SaleRepo(db);
      const res = await saleRepo.getSaleById(sale.id);
      if (res) setSelectedSaleResult(res);
    } catch (err) {
      globalErrorLogger.log(err);
      window.alert('Could not load receipt details.');
    }
  }

  async function openReturnModal(sale: Sale) {
    try {
      const saleRepo = new SaleRepo(db);
      const res = await saleRepo.getSaleById(sale.id);
      if (res) {
        setReturningSale(res);
        const initialQtys: Record<string, number> = {};
        const initialRestocked: Record<string, boolean> = {};
        for (const item of res.items) {
          initialQtys[item.id] = 0;
          initialRestocked[item.id] = true;
        }
        setReturnQuantities(initialQtys);
        setReturnRestocked(initialRestocked);
        setRefundMethod(sale.payment_method);
        setReturnNote('');
        setReturnError('');
      }
    } catch (err) {
      globalErrorLogger.log(err);
      window.alert('Could not open return modal.');
    }
  }

  async function handleSubmitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!returningSale || !shop || !deviceId || returnSubmittingRef.current) return;

    // Validate BEFORE any async work; validation failures show inside the
    // modal instead of throwing an unhandled rejection.
    const linesToReturn: {
      sale_item_id: string;
      variant_id: string;
      qty: number;
      restocked: boolean;
    }[] = [];
    for (const item of returningSale.items) {
      const qty = returnQuantities[item.id] || 0;
      if (qty <= 0) continue;
      const returnedItems = returnItemsMap.get(item.id) || [];
      const alreadyReturned = returnedItems.reduce((sum, ri) => sum + ri.qty, 0);
      if (alreadyReturned + qty > item.qty) {
        setReturnError(
          `Return quantity exceeds remaining quantity for ${item.product_name} (${item.variant_name}).`,
        );
        return;
      }
      linesToReturn.push({
        sale_item_id: item.id,
        variant_id: item.variant_id,
        qty,
        restocked: returnRestocked[item.id] ?? true,
      });
    }

    if (linesToReturn.length === 0) {
      setReturnError('Please specify a return quantity for at least one item.');
      return;
    }

    returnSubmittingRef.current = true;
    setSubmittingReturn(true);
    setReturnError('');

    try {
      const returnRepo = new ReturnRepo(db);
      const returnId = uuidv7();
      const returnItemIds = linesToReturn.map(() => uuidv7());
      const movementIds = linesToReturn.map(() => uuidv7());
      const nowIso = new Date().toISOString();

      const result = await returnRepo.processReturn(
        {
          shop_id: shop.id,
          device_id: deviceId,
          sale_id: returningSale.sale.id,
          returned_at: nowIso,
          refund_method: refundMethod,
          note: returnNote ? returnNote.trim() : null,
          lines: linesToReturn,
        },
        returnId,
        returnItemIds,
        movementIds,
        nowIso,
      );

      setReturnReceipt({ ...result, sale: returningSale.sale, saleItems: returningSale.items });
      setReturningSale(null);
      // A restocking return writes stock movements: refresh the badge now.
      notifyStockChanged();
      await loadData();
    } catch (err: unknown) {
      globalErrorLogger.log(err);
      setReturnError(err instanceof Error ? err.message : 'Failed to process return');
    } finally {
      returnSubmittingRef.current = false;
      setSubmittingReturn(false);
    }
  }

  // Filter sales
  const filteredSales = sales.filter((s) => {
    const matchesSearch =
      !searchQuery ||
      s.receipt_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.note && s.note.toLowerCase().includes(searchQuery.toLowerCase()));

    const sDate = localDate(new Date(s.sold_at));
    const matchesStart = !startDate || sDate >= startDate;
    const matchesEnd = !endDate || sDate <= endDate;

    return matchesSearch && matchesStart && matchesEnd;
  });

  // Per-day totals for filtered sales
  const dailyTotals = new Map<string, { count: number; total: number; refunds: number }>();
  for (const s of filteredSales) {
    const d = localDate(new Date(s.sold_at));
    const cur = dailyTotals.get(d) || { count: 0, total: 0, refunds: 0 };
    cur.count += 1;
    cur.total += s.total;
    const rets = returnsMap.get(s.id) || [];
    const refSum = rets.reduce((sum, r) => sum + r.refund_amount, 0);
    cur.refunds += refSum;
    dailyTotals.set(d, cur);
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading sales history...</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Sales History & Returns</h1>
          <p className="text-sm text-gray-600">Review past sales, search receipts, and process product returns.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Search & Date Filters */}
      <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="w-full md:w-96">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search Receipt No or Note</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. PC-000001..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {(searchQuery || startDate || endDate) && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStartDate('');
                  setEndDate('');
                }}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium min-h-11"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Per-Day Totals Summary */}
      {dailyTotals.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-2">
          <h3 className="text-sm font-bold text-blue-900">Per-Day Totals (Filtered Range)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[...dailyTotals.entries()].map(([date, stats]) => (
              <div key={date} className="bg-white p-3 rounded-lg border shadow-xs text-xs space-y-1">
                <div className="font-bold text-gray-800">{date}</div>
                <div className="flex justify-between text-gray-600">
                  <span>Sales:</span>
                  <span className="font-semibold">{stats.count}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Revenue:</span>
                  <span className="font-semibold text-blue-700">{formatMoney(stats.total, 0, currency)}</span>
                </div>
                {stats.refunds > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Refunds:</span>
                    <span className="font-semibold">-{formatMoney(stats.refunds, 0, currency)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <th className="p-4">Receipt No</th>
                <th className="p-4">Date & Time</th>
                <th className="p-4">Payment</th>
                <th className="p-4 text-right">Total</th>
                <th className="p-4 text-center">Returns</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400">
                    No sales found matching the criteria.
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => {
                  const rets = returnsMap.get(sale.id) || [];
                  const refundedTotal = rets.reduce((sum, r) => sum + r.refund_amount, 0);
                  return (
                    <tr key={sale.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 font-mono font-bold text-blue-700">{sale.receipt_no}</td>
                      <td className="p-4 text-gray-600">{new Date(sale.sold_at).toLocaleString()}</td>
                      <td className="p-4 uppercase font-medium text-gray-700">{sale.payment_method}</td>
                      <td className="p-4 text-right font-bold text-gray-900">
                        {formatMoney(sale.total, 0, currency)}
                        {refundedTotal > 0 && (
                          <span className="block text-xs font-normal text-red-600">
                            Refunded: -{formatMoney(refundedTotal, 0, currency)}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {rets.length > 0 ? (
                          <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-medium">
                            {rets.length} return(s)
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">None</span>
                        )}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => void handleViewReceipt(sale)}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded-lg text-xs font-medium min-h-11 inline-flex items-center"
                        >
                          View / Reprint
                        </button>
                        {rets.map((ret, index) => <button key={ret.id} className="min-h-11 px-3 border rounded" onClick={() => void (async () => {
                          try {
                            const original = await new SaleRepo(db).getSaleById(sale.id);
                            if (!original) throw new Error('Original sale missing');
                            const items = [...returnItemsMap.values()].flat().filter((item) => item.return_id === ret.id);
                            setReturnReceipt({ ret, items, sale: original.sale, saleItems: original.items });
                          } catch (err) { setError(err instanceof Error ? err.message : 'Could not load return receipt'); }
                        })()}>Return receipt {index + 1}</button>)}
                        <button
                          onClick={() => void openReturnModal(sale)}
                          className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-medium min-h-11 inline-flex items-center"
                        >
                          Return
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

      {returnReceipt && shop && <ReturnReceiptModal result={returnReceipt} shop={shop} onClose={() => setReturnReceipt(null)} />}
      {/* Receipt Modal */}
      {selectedSaleResult && shop && (
        <ReceiptModal
          result={selectedSaleResult}
          shop={shop}
          onClose={() => setSelectedSaleResult(null)}
        />
      )}

      {/* Return Modal */}
      {returningSale && shop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-gray-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">Process Return — Receipt {returningSale.sale.receipt_no}</h3>
              <button
                onClick={() => setReturningSale(null)}
                className="text-gray-400 hover:text-white font-bold text-xl px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitReturn} className="p-6 overflow-y-auto space-y-6 flex-1">
              {returnError && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {returnError}
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-800">Select items and quantities to return:</h4>
                <div className="border rounded-lg divide-y bg-gray-50">
                  {returningSale.items.map((item) => {
                    const returnedItems = returnItemsMap.get(item.id) || [];
                    const alreadyReturned = returnedItems.reduce((sum, ri) => sum + ri.qty, 0);
                    const remainingQty = item.qty - alreadyReturned;
                    const currentReturnQty = returnQuantities[item.id] || 0;
                    const isRestocked = returnRestocked[item.id] ?? true;

                    return (
                      <div key={item.id} className="p-3 bg-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 text-sm">
                            {item.product_name} <span className="text-gray-500 font-normal">({item.variant_name})</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5 space-x-3">
                            <span>Sold Qty: {item.qty}</span>
                            <span>Already Returned: {alreadyReturned}</span>
                            <span className="font-bold text-blue-700">Remaining: {remainingQty}</span>
                          </div>
                        </div>

                        {remainingQty > 0 ? (
                          <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                            <label className="flex items-center gap-1.5 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                checked={isRestocked}
                                onChange={(e) =>
                                  setReturnRestocked({ ...returnRestocked, [item.id]: e.target.checked })
                                }
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                              />
                              Restock item
                            </label>

                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-600">Return Qty:</span>
                              <input
                                type="number"
                                min="0"
                                max={remainingQty}
                                value={currentReturnQty}
                                onChange={(e) =>
                                  setReturnQuantities({
                                    ...returnQuantities,
                                    [item.id]: Math.min(remainingQty, Math.max(0, parseInt(e.target.value || '0', 10))),
                                  })
                                }
                                className="w-16 border rounded px-2 py-1 text-center text-sm"
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-gray-400 italic">Fully returned</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Refund Method</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'online')}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="cash">Cash Refund</option>
                    <option value="online">Online / Card Refund</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Return Note / Reason</label>
                  <input
                    type="text"
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    placeholder="Optional return reason..."
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setReturningSale(null)}
                  className="px-4 py-2.5 border rounded-xl hover:bg-gray-100 font-medium text-sm text-gray-700 min-h-11"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-bold py-2.5 px-6 rounded-xl text-sm shadow transition-colors min-h-11"
                >
                  {submittingReturn ? 'Processing...' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
