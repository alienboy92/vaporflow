import { formatMoney, type Return, type ReturnItem, type Sale, type SaleItem, type Shop } from '@vaporflow/core';
import { buildTextReceiptPdf, type PdfLine } from './receipt-pdf';

export interface ReturnReceipt {
  ret: Return;
  items: ReturnItem[];
  sale: Sale;
  saleItems: SaleItem[];
}

export function returnReceiptLines(result: ReturnReceipt, shop: Shop): string[] {
  const money = (value: number) => formatMoney(value, shop.currency_decimals, shop.currency_code);
  return [shop.name, shop.address ?? '', shop.phone ?? '', 'RETURN RECEIPT',
    `Return: ${result.ret.id}`, `Original receipt: ${result.sale.receipt_no}`,
    `Date: ${new Date(result.ret.returned_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`,
    ...result.items.flatMap((item) => {
      const original = result.saleItems.find((line) => line.id === item.sale_item_id);
      if (!original) throw new Error('Original sale line missing from return receipt');
      return [`${original.product_name} (${original.variant_name})`,
        `Qty: ${item.qty} | Refund: ${money(item.refund_amount)}`,
        item.restocked ? 'Restocked' : 'Not restocked'];
    }), `TOTAL REFUND: ${money(result.ret.refund_amount)}`,
    `Refund method: ${result.ret.refund_method}`, result.ret.note ?? '', shop.receipt_footer];
}

export function returnReceiptHtml(lines: string[]): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<div class="receipt">${lines.map((line) => `<p style="overflow-wrap:anywhere">${escape(line)}</p>`).join('')}</div>`;
}

export function returnReceiptPdf(lines: string[]): Uint8Array {
  const content: PdfLine[] = lines.flatMap((text) => {
    const chunks = text.match(/.{1,38}/g) ?? [''];
    return chunks.map((chunk) => ({ text: chunk, align: 'left' as const, bold: text === 'RETURN RECEIPT' || text.startsWith('TOTAL REFUND:'), size: 8 }));
  });
  return buildTextReceiptPdf(content);
}
