import { useState } from 'react';
import type { Shop } from '@bali-hub-pos/core';
import { usePlatform } from '../context/DbProvider';
import { returnReceiptLines, returnReceiptHtml, returnReceiptPdf, type ReturnReceipt } from '../utils/return-receipt';
import { htmlDocument } from '../utils/print';
import { RECEIPT_CSS } from '../utils/receipt-html';

export function ReturnReceiptModal({ result, shop, onClose }: { result: ReturnReceipt; shop: Shop; onClose: () => void }) {
  const platform = usePlatform();
  const [error, setError] = useState('');
  const lines = returnReceiptLines(result, shop);
  async function output(share: boolean) {
    try {
      setError('');
      if (share) {
        await platform.share.shareFile(`return-${result.ret.id}.pdf`, returnReceiptPdf(lines), 'application/pdf');
      } else {
        await platform.printer.printReceipt(
          htmlDocument(returnReceiptHtml(lines), RECEIPT_CSS, 'Return receipt'),
        );
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not output return receipt'); }
  }
  return (
    <div className="vf-modal" role="dialog" aria-modal="true" aria-label="Return receipt">
      <div className="vf-modal-card max-w-md p-4">
        <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="vf-title">Return receipt</h2>
          <button className="icon-button" aria-label="Close return receipt" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="my-4 space-y-0.5 break-words font-mono text-xs text-slate-800">
          {lines.map((line, index) => (
            <p key={index}>{line || '\u00a0'}</p>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          <button className="vf-btn-dark flex-1" onClick={() => void output(false)}>
            Print
          </button>
          <button className="vf-btn-primary flex-1" onClick={() => void output(true)}>
            Share PDF
          </button>
          <button autoFocus className="vf-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
