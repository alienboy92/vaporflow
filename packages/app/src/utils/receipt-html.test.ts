import { describe, it, expect } from 'vitest';
import { buildReceiptHtml, RECEIPT_CSS } from './receipt-html';
import type { Sale, SaleItem, Shop } from '@bali-hub-pos/core';

const now = '2026-11-15T12:00:00.000Z';

const shop: Shop = {
  id: 's1',
  shop_id: 's1',
  name: 'Vapor Shop',
  address: 'Main St 1',
  phone: '555-0100',
  logo_base64: 'data:image/jpeg;base64,abc123',
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

const item: SaleItem = {
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
};

describe('receipt HTML', () => {
  it('contains all SPEC 9.3 fields for a cash sale with a logo', () => {
    const html = buildReceiptHtml(sale, [item], shop);

    expect(html).toContain('id="receipt-print-area"');
    expect(html).toContain('Vapor Shop');
    expect(html).toContain('Main St 1');
    expect(html).toContain('555-0100');
    expect(html).toContain('data:image/jpeg;base64,abc123');
    expect(html).toContain('Receipt: PC1-000001');
    expect(html).toContain('E-Liquid — Menthol 6mg');
    expect(html).toContain('2 × PKR 1,000');
    expect(html).toContain('PKR 2,000'); // line total
    expect(html).toContain('PKR 2,500'); // subtotal
    expect(html).toContain('-PKR 100'); // discount
    expect(html).toContain('PKR 2,400'); // total
    expect(html).toContain('Cash');
    expect(html).toContain('PKR 3,000'); // cash received
    expect(html).toContain('PKR 600'); // change due
    expect(html).toContain('Thank you');
  });

  it('escapes shop and item names', () => {
    const evilShop: Shop = { ...shop, name: '<b>Shop</b> & Sons' };
    const html = buildReceiptHtml(sale, [item], evilShop);
    expect(html).toContain('&lt;b&gt;Shop&lt;/b&gt; &amp; Sons');
    expect(html).not.toContain('<b>Shop</b>');
  });

  it('omits logo, discount, change and footer when not applicable', () => {
    const plainShop: Shop = {
      ...shop,
      logo_base64: null,
      address: null,
      phone: null,
      receipt_footer: '',
    };
    const onlineSale: Sale = { ...sale, payment_method: 'online', amount_received: null, discount_amount: 0 };
    const html = buildReceiptHtml(onlineSale, [item], plainShop);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('Discount');
    expect(html).not.toContain('Change due');
    expect(html).not.toContain('Cash received');
    expect(html).not.toContain('Thank you');
    expect(html).toContain('Online');
  });

  it('ships an 80mm-oriented stylesheet', () => {
    expect(RECEIPT_CSS).toContain('.receipt { width: 72mm;');
    expect(RECEIPT_CSS).toContain('mm;'); // metric sizing for thermal paper
  });
});
