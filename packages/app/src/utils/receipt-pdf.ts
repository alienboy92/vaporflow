/**
 * Minimal PDF generator for 80mm receipts (PDF 1.4, Courier/Courier-Bold).
 * Pure string/byte construction with correct xref offsets — no dependencies.
 * The shop logo is not embedded (text-only PDF); the HTML receipt carries it.
 */
import { formatMoney } from '@vaporflow/core';
import type { Sale, SaleItem, Shop } from '@vaporflow/core';

/** 80 mm in PostScript points (1 mm = 72/25.4 pt). */
export const RECEIPT_PDF_WIDTH_PT = Math.round((80 * 72 * 100) / 25.4) / 100; // 226.77

const MARGIN = 10;
const LINE_HEIGHT = 11;

interface PdfLine {
  text: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  size: number;
}

/** Escapes a string for a PDF literal and strips anything outside latin1. */
function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function charWidth(size: number): number {
  // Courier family: fixed 600/1000 per em.
  return 0.6 * size;
}

function xFor(line: PdfLine, widthPt: number): number {
  const w = line.text.length * charWidth(line.size);
  if (line.align === 'center') return Math.max(MARGIN, (widthPt - w) / 2);
  if (line.align === 'right') return Math.max(MARGIN, widthPt - MARGIN - w);
  return MARGIN;
}

function money(shop: Shop, amount: number): string {
  return formatMoney(amount, shop.currency_decimals, shop.currency_code);
}

/** Builds the text lines (top to bottom) for the receipt content. */
export function buildReceiptPdfLines(sale: Sale, items: SaleItem[], shop: Shop): PdfLine[] {
  const lines: PdfLine[] = [];
  const push = (
    text: string,
    align: PdfLine['align'] = 'left',
    bold = false,
    size = 8,
  ): void => {
    lines.push({ text, align, bold, size });
  };

  if (shop.show_logo_on_receipt && shop.logo_base64) {
    push('[logo]', 'center', false, 8);
  }
  push(shop.name, 'center', true, 11);
  if (shop.address) push(shop.address, 'center', false, 8);
  if (shop.phone) push(shop.phone, 'center', false, 8);
  push('');
  push(`Receipt: ${sale.receipt_no}`);
  push(`Date: ${new Date(sale.sold_at).toISOString().replace('T', ' ').slice(0, 16)}`);
  push('');
  push('Item                  Total', 'left', true, 7);
  for (const item of items) {
    const name = item.variant_name
      ? `${item.product_name} - ${item.variant_name}`
      : item.product_name;
    const truncated = name.length > 34 ? name.slice(0, 33) + '…' : name;
    push(truncated, 'left', false, 7);
    push(`${item.qty} x ${money(shop, item.unit_price)}`, 'left', false, 7);
    push(money(shop, item.net_total), 'right', false, 8);
    push('');
  }
  push('------------------------------', 'left', false, 8);
  push('Subtotal', 'left', false, 8);
  push(money(shop, sale.subtotal), 'right', false, 8);
  if (sale.discount_amount) {
    push('Discount', 'left', false, 8);
    push(`-${money(shop, sale.discount_amount)}`, 'right', false, 8);
  }
  push('TOTAL', 'left', true, 10);
  push(money(shop, sale.total), 'right', true, 10);
  push(`Payment: ${sale.payment_method === 'cash' ? 'Cash' : 'Online'}`, 'left', false, 8);
  if (sale.payment_method === 'cash' && sale.amount_received !== null) {
    push('Cash received', 'left', false, 8);
    push(money(shop, sale.amount_received), 'right', false, 8);
    push('Change due', 'left', false, 8);
    push(money(shop, sale.amount_received - sale.total), 'right', false, 8);
  }
  push('');
  if (shop.receipt_footer) push(shop.receipt_footer, 'center', false, 8);
  return lines;
}

/**
 * Builds a complete, valid PDF 1.4 document for the receipt as bytes.
 * Layout is fixed-width Courier so amounts right-align exactly.
 */
export function buildReceiptPdf(sale: Sale, items: SaleItem[], shop: Shop): Uint8Array {
  const contentLines = buildReceiptPdfLines(sale, items, shop);
  const widthPt = RECEIPT_PDF_WIDTH_PT;
  const heightPt = Math.round((contentLines.length * LINE_HEIGHT + MARGIN * 2) * 100) / 100;

  const ops: string[] = [];
  contentLines.forEach((line, index) => {
    const y = heightPt - MARGIN - line.size - index * LINE_HEIGHT;
    if (!line.text) return;
    const x = xFor(line, widthPt);
    const font = line.bold ? '/F2' : '/F1';
    ops.push(
      `BT ${font} ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(
        line.text,
      )}) Tj ET`,
    );
  });
  const stream = ops.join('\n');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(
      2,
    )}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  // Assemble with byte offsets (latin1: one char = one byte).
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
