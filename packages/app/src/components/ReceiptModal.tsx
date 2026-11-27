import { useState, type ReactNode } from 'react';
import { Shop, Sale, SaleItem, Return, formatMoney } from '@bali-hub-pos/core';
import { usePlatform } from '../context/DbProvider';
import { buildReceiptHtml, RECEIPT_CSS } from '../utils/receipt-html';
import { buildReceiptPdf } from '../utils/receipt-pdf';
import { htmlDocument } from '../utils/print';
import { globalErrorLogger } from '../utils/logger';

interface ReceiptModalProps {
  result: { sale: Sale; items: SaleItem[] };
  shop: Shop;
  onClose: () => void;
  historyPanel?: boolean;
  newSale?: boolean;
  actions?: ReactNode;
  /** Quantity already returned per sale-item id (history view only). */
  returnedQuantities?: Record<string, number>;
  /** Returns recorded against this sale (history view only). */
  returns?: Return[];
  onReturnReceipt?: (ret: Return) => void;
}

export function ReceiptModal({
  result,
  shop,
  onClose,
  historyPanel,
  actions,
  newSale,
  returnedQuantities,
  returns,
  onReturnReceipt,
}: ReceiptModalProps) {
  const { sale, items } = result;
  const platform = usePlatform();
  const [error, setError] = useState('');
  const currency = shop.currency_code ?? 'PKR';
  const decimals = shop.currency_decimals ?? 0;

  async function handlePrint() {
    setError('');
    try {
      const html = htmlDocument(
        buildReceiptHtml(sale, items, shop),
        RECEIPT_CSS,
        `Receipt ${sale.receipt_no}`,
      );
      await platform.printer.printReceipt(html);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Could not open the print dialog. Check that a printer is available.');
    }
  }

  async function handleShare() {
    setError('');
    const fileName = `receipt-${sale.receipt_no}.pdf`;
    try {
      const bytes = await buildReceiptPdf(sale, items, shop);
      await platform.share.shareFile(fileName, bytes, 'application/pdf');
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Could not share the receipt. The file may not be shareable on this device.');
    }
  }

  return (
    <div className={historyPanel ? "history-detail" : "vf-modal"}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-slate-900 p-4 text-white">
          <h3 className="text-base font-bold">Receipt Details ({sale.receipt_no})</h3>
          <button onClick={onClose} className="icon-button text-xl font-bold text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Close receipt">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-white p-6 font-mono text-xs text-slate-800">
          <div className="text-center space-y-1">
            {shop.show_logo_on_receipt === 1 && shop.logo_base64 && (
              <div className="flex justify-center mb-2">
                <img src={shop.logo_base64} alt="Shop Logo" className="max-h-16 max-w-[120px] object-contain" />
              </div>
            )}
            <h4 className="font-bold text-sm">{shop.name}</h4>
            {shop.address && <p>{shop.address}</p>}
            {shop.phone && <p>Tel: {shop.phone}</p>}
          </div>

          <div className="border-t border-b border-dashed py-2 space-y-1">
            <div className="flex justify-between">
              <span>Receipt No:</span>
              <span className="font-bold">{sale.receipt_no}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{new Date(sale.sold_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</span>
            </div>
            <div className="flex justify-between">
              <span>Payment:</span>
              <span className="uppercase">{sale.payment_method}</span>
            </div>
            {sale.note && (
              <div className="flex justify-between">
                <span>Note:</span>
                <span>{sale.note}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="border-b pb-1 font-bold flex justify-between text-[11px]">
              <span>ITEM</span>
              <span>QTY x PRICE</span>
              <span>TOTAL</span>
            </div>
            {items.map((item) => {
              const returnedQty = returnedQuantities?.[item.id] ?? 0;
              return (
                <div key={item.id} className="space-y-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold">
                      {item.product_name} ({item.variant_name})
                    </span>
                    {returnedQty > 0 && (
                      <span className="vf-badge-amber shrink-0">
                        {returnedQty} returned
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span></span>
                    <span>{item.qty} x {formatMoney(item.unit_price, decimals, currency)}</span>
                    <span>{formatMoney(item.net_total, decimals, currency)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-dashed pt-2 space-y-1 text-right">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{formatMoney(sale.subtotal, decimals, currency)}</span>
            </div>
            {sale.discount_amount > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>Discount:</span>
                <span>-{formatMoney(sale.discount_amount, decimals, currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 text-sm font-bold text-slate-900">
              <span>Total:</span>
              <span>{formatMoney(sale.total, decimals, currency)}</span>
            </div>
            {sale.payment_method === 'cash' && sale.amount_received !== null && (
              <>
                <div className="flex justify-between text-slate-600">
                  <span>Cash Received:</span>
                  <span>{formatMoney(sale.amount_received, decimals, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Change Due:</span>
                  <span>{formatMoney(Math.max(0, sale.amount_received - sale.total), decimals, currency)}</span>
                </div>
              </>
            )}
          </div>

          {historyPanel && returns && returns.length > 0 && (
            <div className="border-t border-amber-200 pt-3">
              <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-800">
                Returns Recorded Against This Sale
              </h5>
              <div className="space-y-2">
                {returns.map((ret) => (
                  <div
                    key={ret.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 font-sans text-xs text-amber-900"
                  >
                    <div className="min-w-0">
                      <div className="font-bold">{new Date(ret.returned_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</div>
                      <div className="text-amber-800">
                        Refund via <strong className="uppercase">{ret.refund_method}</strong>
                      </div>
                      {ret.note && <div className="text-amber-700">Note: {ret.note}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="vf-num font-bold">-{formatMoney(ret.refund_amount, decimals, currency)}</span>
                      {onReturnReceipt && (
                        <button
                          type="button"
                          onClick={() => onReturnReceipt(ret)}
                          className="vf-btn-ghost min-h-9 px-2.5 text-[11px]"
                        >
                          Return receipt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-4 text-center text-[11px] text-slate-500">
            {shop.receipt_footer || 'Thank you for shopping with us!'}
          </div>
        </div>

        {actions}
        {error && (
          <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex gap-3 border-t border-slate-200 bg-slate-50 p-4">
          <button
            onClick={() => void handlePrint()}
            className="vf-btn-dark flex-1"
          >
            Print Receipt
          </button>
          <button
            onClick={() => void handleShare()}
            className="vf-btn-primary flex-1"
          >
            Share PDF
          </button>
          <button
            onClick={onClose}
            className="vf-btn-ghost"
          >
            {newSale ? 'New sale' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
