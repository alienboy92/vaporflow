import { it, expect } from 'vitest';
import type { Sale, SaleItem, Shop } from '@bali-hub-pos/core';
import { returnReceiptLines, returnReceiptHtml, returnReceiptPdf, type ReturnReceipt } from './return-receipt';
const now = '2026-11-15T12:00:00.000Z';

const shop: Shop = {
  id: 's1',
  shop_id: 's1',
  name: 'Vapor Shop',
  address: 'Main St 1',
  phone: '555-0100',
  logo_base64: null,
  show_logo_on_receipt: 1,
  currency_code: 'PKR',
  currency_decimals: 0,
  receipt_footer: 'Thank you',
  default_low_stock_threshold: 3,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  device_id: 'd1',
  dirty: 0,
  server_updated_at: null,
};

const sale: Sale = {
  id: 'sale1',
  shop_id: 's1',
  receipt_no: 'PC1-000001',
  sold_at: now,
  subtotal: 2500,
  discount_amount: 100,
  total: 2400,
  payment_method: 'cash',
  amount_received: 3000,
  note: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  device_id: 'd1',
  dirty: 1,
  server_updated_at: null,
};

const items: SaleItem[] = [
  {
    id: 'i1',
    shop_id: 's1',
    sale_id: 'sale1',
    variant_id: 'v1',
    product_name: 'E-Liquid',
    variant_name: 'Menthol 6mg',
    qty: 2,
    list_price: 1000,
    unit_price: 1000,
    unit_cost: 500,
    net_total: 2000,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: 'd1',
    dirty: 1,
    server_updated_at: null,
  },
  {
    id: 'i2',
    shop_id: 's1',
    sale_id: 'sale1',
    variant_id: 'v2',
    product_name: 'Coil',
    variant_name: '',
    qty: 1,
    list_price: 600,
    unit_price: 600,
    unit_cost: 300,
    net_total: 400,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: 'd1',
    dirty: 1,
    server_updated_at: null,
  },
];

/** Decodes the produced bytes back to latin1 for structural assertions. */



it('prints saved partial refund amounts, method, restock decisions, and original receipt', () => {
  const result: ReturnReceipt = {
    sale, saleItems: items,
    ret: { ...sale, id: 'return-1', sale_id: sale.id, returned_at: now, refund_amount: 667, refund_method: 'online', note: '<script>note</script>' },
    items: [{ ...items[0]!, id: 'returned-line', return_id: 'return-1', sale_item_id: items[0]!.id, qty: 1, refund_amount: 667, restocked: 0 }],
  };
  const lines = returnReceiptLines(result, shop);
  expect(lines).toContain('Original receipt: PC1-000001');
  expect(lines).toContain('Refund method: online');
  expect(lines).toContain('Not restocked');
  expect(lines.some((line) => line.includes('667'))).toBe(true);
  const html = returnReceiptHtml(lines);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  const pdf = new TextDecoder().decode(returnReceiptPdf(lines));
  expect(pdf).toContain('%PDF-1.4');
  expect(pdf).toContain('TOTAL REFUND');
  expect(pdf).toContain('667');
  result.items[0]!.refund_amount = -1;
  result.ret.refund_amount = -1;
  result.items[0]!.restocked = 1;
  expect(returnReceiptLines(result, shop)).toContain('Restocked');
  expect(returnReceiptLines(result, shop).some((line) => line.includes('-1'))).toBe(true);
});
