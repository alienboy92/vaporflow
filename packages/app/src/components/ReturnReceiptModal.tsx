import { useState } from 'react';
import type { Shop } from '@vaporflow/core';
import { usePlatform } from '../context/DbProvider';
import { returnReceiptLines, returnReceiptHtml, returnReceiptPdf, type ReturnReceipt } from '../utils/return-receipt';
import { printHtml } from '../utils/print';
import { RECEIPT_CSS } from '../utils/receipt-html';

export function ReturnReceiptModal({ result, shop, onClose }: { result: ReturnReceipt; shop: Shop; onClose: () => void }) {
  const platform = usePlatform();
  const [error, setError] = useState('');
  const lines = returnReceiptLines(result, shop);
  async function output(share: boolean) {
    try {
      setError('');
      if (share) await platform.share.shareFile(`return-${result.ret.id}.pdf`, returnReceiptPdf(lines), 'application/pdf');
      else printHtml(returnReceiptHtml(lines), RECEIPT_CSS, 'Return receipt');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not output return receipt'); }
  }
  return <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Return receipt">
    <div className="bg-white rounded-xl p-4 max-w-md w-full max-h-[90vh] overflow-y-auto">
      <h2 className="font-bold text-lg">Return receipt</h2>
      <div className="my-4 font-mono text-xs break-words">{lines.map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 flex-wrap">
        <button className="min-h-11 px-4 border rounded" onClick={() => void output(false)}>Print</button>
        <button className="min-h-11 px-4 border rounded" onClick={() => void output(true)}>Share PDF</button>
        <button autoFocus className="min-h-11 px-4 border rounded" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}
