/** Receipt HTML builders (80mm thermal layout). Pure string functions, no DOM. */
import { formatMoney } from '@vaporflow/core';
import type { Sale, SaleItem, Shop } from '@vaporflow/core';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function money(shop: Shop, amount: number): string {
  return escapeHtml(formatMoney(amount, shop.currency_decimals, shop.currency_code));
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  return new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Renders one 80mm receipt as a complete HTML document body fragment. */
export function buildReceiptHtml(sale: Sale, items: SaleItem[], shop: Shop): string {
  const lines = items
    .map(
      (item) => `
      <tr>
        <td class="qty">${escapeHtml(item.product_name)}${item.variant_name ? ` — ${escapeHtml(item.variant_name)}` : ''}<br>${item.qty} × ${money(shop, item.unit_price)}</td>
        <td class="amount">${money(shop, item.net_total)}</td>
      </tr>`,
    )
    .join('');

  const logo =
    shop.show_logo_on_receipt && shop.logo_base64
      ? `<div class="logo"><img src="${escapeHtml(shop.logo_base64)}" alt="Shop logo"></div>`
      : '';

  const contact = [
    shop.address ? escapeHtml(shop.address) : '',
    shop.phone ? escapeHtml(shop.phone) : '',
  ]
    .filter(Boolean)
    .join('<br>');

  const changeDue =
    sale.payment_method === 'cash' && sale.amount_received !== null
      ? `<tr class="total"><td>Change due</td><td class="amount">${money(
          shop,
          sale.amount_received - sale.total,
        )}</td></tr>`
      : '';

  return `
  <div id="receipt-print-area" class="receipt">
    ${logo}
    <div class="shop-name">${escapeHtml(shop.name)}</div>
    ${contact ? `<div class="shop-contact">${contact}</div>` : ''}
    <div class="meta">
      <div>Receipt: ${escapeHtml(sale.receipt_no)}</div>
      <div>${formatDateTime(sale.sold_at)}</div>
    </div>
    <table class="lines">
      <thead><tr><th class="qty">Item</th><th class="amount">Total</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <table class="totals">
      <tbody>
        <tr><td>Subtotal</td><td class="amount">${money(shop, sale.subtotal)}</td></tr>
        ${sale.discount_amount ? `<tr><td>Discount</td><td class="amount">-${money(shop, sale.discount_amount)}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td class="amount">${money(shop, sale.total)}</td></tr>
        <tr><td>Payment</td><td class="amount">${escapeHtml(
          sale.payment_method === 'cash' ? 'Cash' : 'Online',
        )}</td></tr>
        ${
          sale.payment_method === 'cash' && sale.amount_received !== null
            ? `<tr><td>Cash received</td><td class="amount">${money(shop, sale.amount_received)}</td></tr>`
            : ''
        }
        ${changeDue}
      </tbody>
    </table>
    ${shop.receipt_footer ? `<div class="footer">${escapeHtml(shop.receipt_footer)}</div>` : ''}
  </div>`;
}

/** Default stylesheet for the 80mm receipt (used by print and the modal preview). */
export const RECEIPT_CSS = `
@page { size: 80mm auto; margin: 0; }
.receipt { width: 72mm; font-family: 'Courier New', monospace; font-size: 10pt; color: #000; }
.receipt .logo { text-align: center; margin-bottom: 2mm; }
.receipt .logo img { max-width: 30mm; max-height: 20mm; }
.receipt .shop-name { text-align: center; font-weight: bold; font-size: 12pt; }
.receipt .shop-contact { text-align: center; font-size: 9pt; }
.receipt .meta { margin: 2mm 0; }
.receipt table { width: 100%; border-collapse: collapse; }
.receipt th { text-align: left; border-bottom: 1px dashed #000; font-size: 9pt; }
.receipt td { padding: 0.5mm 0; vertical-align: top; font-size: 9pt; }
.receipt .qty { width: 70%; }
.receipt .amount { width: 30%; text-align: right; white-space: nowrap; }
.receipt .totals { margin-top: 2mm; border-top: 1px dashed #000; padding-top: 1mm; }
.receipt .totals .total { font-weight: bold; font-size: 11pt; }
.receipt .footer { text-align: center; margin-top: 3mm; }
`;
