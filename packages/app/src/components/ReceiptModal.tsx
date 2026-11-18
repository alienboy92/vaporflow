import type { ReactNode } from 'react';
import { Shop, Sale, SaleItem, formatMoney } from '@vaporflow/core';
import { usePlatform } from '../context/DbProvider';
import { buildReceiptHtml, RECEIPT_CSS } from '../utils/receipt-html';
import { buildReceiptPdf } from '../utils/receipt-pdf';
import { printHtml } from '../utils/print';
import { globalErrorLogger } from '../utils/logger';

interface ReceiptModalProps {
  result: { sale: Sale; items: SaleItem[] };
  shop: Shop;
  onClose: () => void;
  historyPanel?: boolean;
  newSale?: boolean;
  actions?: ReactNode;
}

export function ReceiptModal({ result, shop, onClose, historyPanel, actions, newSale }: ReceiptModalProps) {
  const { sale, items } = result;
  const platform = usePlatform();
  const currency = shop.currency_code ?? 'PKR';

  function handlePrint() {
    try {
      printHtml(buildReceiptHtml(sale, items, shop), RECEIPT_CSS, `Receipt ${sale.receipt_no}`);
    } catch (err) {
      globalErrorLogger.log(err);
      window.alert('Could not open the print dialog. Check that a printer is available.');
    }
  }

  async function handleShare() {
    const fileName = `receipt-${sale.receipt_no}.pdf`;
    try {
      const bytes = buildReceiptPdf(sale, items, shop);
      await platform.share.shareFile(fileName, bytes, 'application/pdf');
    } catch (err) {
      globalErrorLogger.log(err);
      window.alert('Could not share the receipt. The file may not be shareable on this device.');
    }
  }

  return (
    <div className={historyPanel ? "history-detail" : "fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 bg-gray-900 text-white flex justify-between items-center">
          <h3 className="font-bold text-lg">Receipt Details ({sale.receipt_no})</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white font-bold text-xl px-2">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 font-mono text-xs text-gray-800 bg-white flex-1">
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
              <span>{new Date(sale.sold_at).toLocaleString()}</span>
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
            {items.map((item) => (
              <div key={item.id} className="space-y-0.5">
                <div className="font-bold">{item.product_name} ({item.variant_name})</div>
                <div className="flex justify-between text-gray-600">
                  <span></span>
                  <span>{item.qty} x {formatMoney(item.unit_price, 0, currency)}</span>
                  <span>{formatMoney(item.net_total, 0, currency)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed pt-2 space-y-1 text-right">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{formatMoney(sale.subtotal, 0, currency)}</span>
            </div>
            {sale.discount_amount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount:</span>
                <span>-{formatMoney(sale.discount_amount, 0, currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t">
              <span>Total:</span>
              <span>{formatMoney(sale.total, 0, currency)}</span>
            </div>
            {sale.payment_method === 'cash' && sale.amount_received !== null && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Cash Received:</span>
                  <span>{formatMoney(sale.amount_received, 0, currency)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Change Due:</span>
                  <span>{formatMoney(Math.max(0, sale.amount_received - sale.total), 0, currency)}</span>
                </div>
              </>
            )}
          </div>

          <div className="text-center pt-4 text-gray-500 text-[11px] border-t">
            {shop.receipt_footer || 'Thank you for shopping with us!'}
          </div>
        </div>

        {actions}
        <div className="p-4 bg-gray-50 border-t flex gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-medium py-2.5 px-4 rounded-xl min-h-11 flex items-center justify-center gap-2"
          >
            Print Receipt
          </button>
          <button
            onClick={() => void handleShare()}
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-medium py-2.5 px-4 rounded-xl min-h-11 flex items-center justify-center gap-2"
          >
            Share PDF
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border rounded-xl hover:bg-gray-100 font-medium min-h-11 text-gray-700"
          >
            {newSale ? 'New sale' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
