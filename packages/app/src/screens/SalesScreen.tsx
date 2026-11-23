import { useRecordWindow } from '../utils/use-record-window';
import { useCloudSync } from '../context/CloudSyncProvider';
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
import { PinPrompt } from '../components/PinPrompt';
import { useToast } from '../components/Toast';

export function SalesScreen({ pinEnabled = false }: { pinEnabled?: boolean }) {
  const db = useDb();
  const toast = useToast();
  const [returnReceipt, setReturnReceipt] = useState<ReturnReceipt | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [returnsMap, setReturnsMap] = useState<Map<string, Return[]>>(new Map());
  const [returnItemsMap, setReturnItemsMap] = useState<Map<string, ReturnItem[]>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const lastSync = useCloudSync().status.lastSuccessAt;
  const [overReturns, setOverReturns] = useState<Awaited<ReturnType<ReturnRepo['getOverReturns']>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Selected sale for receipt viewing / reprinting
  const [selectedSaleResult, setSelectedSaleResult] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);

  // Return modal state
  const [returningSale, setReturningSale] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);
  // Sale waiting for the PIN prompt before a return can be initiated.
  const [pendingReturnSale, setPendingReturnSale] = useState<Sale | null>(null);
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
      setOverReturns(await returnRepo.getOverReturns(activeShop.id));
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
  }, [loadData, lastSync]);

  // Android back button: close the topmost receipt/return modal first. The
  // return-form panel is inline state, not a stacked dialog, so only modals
  // register here.
  useEffect(() => {
    const modalOpen = Boolean(returningSale || returnReceipt || selectedSaleResult);
    if (!modalOpen) return;
    return registerBackHandler(() => {
      if (returnReceipt) setReturnReceipt(null);
      else if (returningSale) setReturningSale(null);
      else setSelectedSaleResult(null);
      return true;
    });
  }, [returningSale, returnReceipt, selectedSaleResult]);

  async function handleViewReceipt(sale: Sale) {
    try {
      const saleRepo = new SaleRepo(db);
      const res = await saleRepo.getSaleById(sale.id);
      if (res) setSelectedSaleResult(res);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Could not load receipt details.');
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
      setError('Could not open return modal.');
    }
  }

  function requestReturn(sale: Sale) {
    if (pinEnabled) {
      setPendingReturnSale(sale);
      return;
    }
    void openReturnModal(sale);
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
      toast.show('Return processed');
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

  const recordWindow = useRecordWindow(filteredSales);
  if (loading) {
    return <div className="vf-page text-sm text-slate-500">Loading sales history…</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;
  const selectedReturned: Record<string, number> = {};
  if (selectedSaleResult) {
    for (const item of selectedSaleResult.items) {
      const returnedItems = returnItemsMap.get(item.id) ?? [];
      selectedReturned[item.id] = returnedItems.reduce((sum, ri) => sum + ri.qty, 0);
    }
  }

  return (
    <div className="vf-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vf-sub max-w-xl">
          Immutable sale ledger with reprints, per-line returns and refund history.
        </p>
      </div>

      {overReturns.length > 0 && <section role="alert" className="rounded-xl border border-amber-400 p-3">
        <h2>Returns requiring reconciliation</h2>
        <p>Check the refund payments and count the stock for these receipts.</p>
        <ul>{overReturns.map(row => <li key={row.item_id}>{row.receipt_no} · {row.product_name} ({row.variant_name}) · Sold {row.sold}, returned {row.returned}</li>)}</ul>
      </section>}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {/* Search and date filters */}
      <div className="vf-card flex flex-col items-stretch justify-between gap-4 p-4 md:flex-row md:items-end">
        <div className="w-full md:w-96">
          <label className="vf-label" htmlFor="sales-search">
            Search Receipt No or Note
          </label>
          <input
            id="sales-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. PC1-000001"
            className="vf-input"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="vf-label" htmlFor="sales-from">
              From Date
            </label>
            <input
              id="sales-from"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="vf-input"
            />
          </div>
          <div>
            <label className="vf-label" htmlFor="sales-to">
              To Date
            </label>
            <input
              id="sales-to"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="vf-input"
            />
          </div>
          {(searchQuery || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setStartDate('');
                setEndDate('');
              }}
              className="vf-btn-ghost"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Per-day totals summary */}
      {dailyTotals.size > 0 && (
        <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="text-sm font-bold text-emerald-900">Per-Day Totals (Filtered Range)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {[...dailyTotals.entries()].map(([date, stats]) => (
              <div key={date} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="font-bold text-slate-800">{date}</div>
                <div className="flex justify-between text-slate-600">
                  <span>Sales:</span>
                  <span className="vf-num font-semibold">{stats.count}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Revenue:</span>
                  <span className="vf-num font-semibold text-emerald-700">{formatMoney(stats.total, decimals, currency)}</span>
                </div>
                {stats.refunds > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Refunds:</span>
                    <span className="vf-num font-semibold">-{formatMoney(stats.refunds, decimals, currency)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sales-workspace">
        <section aria-label="Sales history"><div ref={recordWindow.viewport} style={recordWindow.viewportStyle}><div className="space-y-2" style={recordWindow.padding}>
          {!filteredSales.length && <p className="catalog-empty">No sales match these filters.</p>}
          {recordWindow.visible.map((sale, i) => {
            const returns = returnsMap.get(sale.id) ?? [];
            const refunded = returns.reduce((sum, r) => sum + r.refund_amount, 0);
            return <button key={sale.id} ref={recordWindow.measure} data-index={recordWindow.start + i} onClick={() => void handleViewReceipt(sale)}
              aria-pressed={sale.id === selectedSaleResult?.sale.id} className="receipt-row">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong>{sale.receipt_no}</strong>
                  <span className="vf-badge-slate uppercase">{sale.payment_method}</span>
                  {returns.length > 0 && <span className="vf-badge-amber">Returned</span>}
                </span>
                <small>{new Date(sale.sold_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</small>
              </span>
              <span className="text-right">
                <strong>{formatMoney(sale.total, decimals, currency)}</strong>
                {returns.length > 0 && <small>{returns.length} return(s) · {formatMoney(refunded, decimals, currency)}</small>}
              </span>
            </button>;
          })}
        </div></div></section>
      {/* Receipt Modal */}
      {selectedSaleResult && shop && (
        <ReceiptModal
          actions={
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
              <button
                className="vf-btn-danger"
                onClick={() => requestReturn(selectedSaleResult.sale)}
              >
                Process return
              </button>
            </div>
          }
          historyPanel
          result={selectedSaleResult}
          shop={shop}
          returnedQuantities={selectedReturned}
          returns={returnsMap.get(selectedSaleResult.sale.id) ?? []}
          onReturnReceipt={(ret) => {
            const items = [...returnItemsMap.values()].flat().filter(item => item.return_id === ret.id);
            setReturnReceipt({ ret, items, sale: selectedSaleResult.sale, saleItems: selectedSaleResult.items });
          }}
          onClose={() => setSelectedSaleResult(null)}
        />
      )}

      {!selectedSaleResult && <div className="history-empty">Select a receipt to view sale details.</div>}
      </div>
      {returnReceipt && shop && <ReturnReceiptModal result={returnReceipt} shop={shop} onClose={() => setReturnReceipt(null)} />}
      {pendingReturnSale && (
        <PinPrompt
          title="PIN required for return"
          description="Enter your PIN to start a return."
          onSuccess={() => {
            const sale = pendingReturnSale;
            setPendingReturnSale(null);
            void openReturnModal(sale);
          }}
          onCancel={() => setPendingReturnSale(null)}
        />
      )}
      {/* Return Modal */}
      {returningSale && shop && (
        <div className="vf-modal">
          <div className="vf-modal-card flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
            <div className="flex items-center justify-between bg-slate-900 p-4 text-white">
              <h3 className="text-base font-bold">Process Return — Receipt {returningSale.sale.receipt_no}</h3>
              <button
                onClick={() => setReturningSale(null)}
                className="icon-button text-xl font-bold text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Close return"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitReturn} className="flex-1 space-y-6 overflow-y-auto p-5">
              {returnError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {returnError}
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Select items and quantities to return:</h4>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50">
                  {returningSale.items.map((item) => {
                    const returnedItems = returnItemsMap.get(item.id) || [];
                    const alreadyReturned = returnedItems.reduce((sum, ri) => sum + ri.qty, 0);
                    const remainingQty = item.qty - alreadyReturned;
                    const currentReturnQty = returnQuantities[item.id] || 0;
                    const isRestocked = returnRestocked[item.id] ?? true;

                    return (
                      <div key={item.id} className="flex flex-col items-start justify-between gap-3 bg-white p-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {item.product_name} <span className="font-normal text-slate-500">({item.variant_name})</span>
                          </div>
                          <div className="mt-0.5 space-x-3 text-xs text-slate-600">
                            <span>Sold Qty: {item.qty}</span>
                            <span>Already Returned: {alreadyReturned}</span>
                            <span className="font-bold text-emerald-700">Remaining: {remainingQty}</span>
                          </div>
                        </div>

                        {remainingQty > 0 ? (
                          <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                            <label className="flex items-center gap-1.5 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={isRestocked}
                                onChange={(e) =>
                                  setReturnRestocked({ ...returnRestocked, [item.id]: e.target.checked })
                                }
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              Restock item
                            </label>

                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-600">Return Qty:</span>
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
                                className="vf-input w-16 px-2 text-center"
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-medium italic text-slate-400">Fully returned</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="vf-label" htmlFor="refund-method">
                    Refund Method
                  </label>
                  <select
                    id="refund-method"
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'online')}
                    className="vf-select"
                  >
                    <option value="cash">Cash Refund</option>
                    <option value="online">Online / Card Refund</option>
                  </select>
                </div>
                <div>
                  <label className="vf-label" htmlFor="return-note">
                    Return Note / Reason
                  </label>
                  <input
                    id="return-note"
                    type="text"
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    placeholder="Optional return reason…"
                    className="vf-input"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setReturningSale(null)}
                  className="vf-btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="vf-btn-primary bg-rose-600 border-rose-600 hover:bg-rose-700"
                >
                  {submittingReturn ? 'Processing…' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
