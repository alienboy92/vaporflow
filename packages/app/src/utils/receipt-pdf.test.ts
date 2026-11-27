import { describe, it, expect } from 'vitest';
import { buildReceiptPdf, RECEIPT_PDF_WIDTH_PT, buildReceiptPdfLines } from './receipt-pdf';
import type { Sale, SaleItem, Shop } from '@bali-hub-pos/core';

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
function decode(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

describe('receipt PDF builder', () => {
  it('produces a structurally valid PDF with correct xref offsets', async () => {
    const bytes = await buildReceiptPdf(sale, items, shop);
    const pdf = decode(bytes);

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    // startxref points at the xref table itself.
    const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(pdf.slice(startxref, startxref + 5)).toBe('xref\n');

    // Every xref entry points exactly at its "N 0 obj" header.
    const xrefSection = pdf.slice(startxref, pdf.indexOf('trailer'));
    const entries = xrefSection.split('\n').filter((l) => /^\d{10} 00000 n $/.test(l));
    expect(entries).toHaveLength(6);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });

    // Trailer references the catalog as root.
    expect(pdf).toContain('/Root 1 0 R');
  });

  it('uses an 80mm page width and lays out receipt content', async () => {
    const pdf = decode(await buildReceiptPdf(sale, items, shop));
    expect(pdf).toContain(`/MediaBox [0 0 ${RECEIPT_PDF_WIDTH_PT.toFixed(2)}`);
    // Shop name, receipt number, totals and change due are present in the stream.
    expect(pdf).toContain('(Vapor Shop) Tj');
    expect(pdf).toContain('(Receipt: PC1-000001) Tj');
    expect(pdf).toContain('(PKR 2,400) Tj');
    expect(pdf).toContain('(PKR 600) Tj'); // change due 3000 - 2400
    expect(pdf).toContain('(Discount) Tj');
    expect(pdf).toContain('(Thank you) Tj');
  });

  it('escapes parentheses and strips non-latin1 characters', async () => {
    const weirdShop: Shop = { ...shop, name: 'Café (Main)' };
    const lines = buildReceiptPdfLines(sale, items, weirdShop);
    const nameLine = lines.find((l) => l.text.includes('Main'))!;
    expect(nameLine.text).toBe('Café (Main)');

    const bytes = await buildReceiptPdf(sale, items, weirdShop);
    const pdf = decode(bytes);
    expect(pdf).toContain('(Café \\(Main\\)) Tj');
  });

  it('omits cash fields for online payments', () => {
    const onlineSale: Sale = { ...sale, payment_method: 'online', amount_received: null };
    const lines = buildReceiptPdfLines(onlineSale, items, shop);
    expect(lines.some((l) => l.text === 'Change due')).toBe(false);
    expect(lines.some((l) => l.text === 'Cash received')).toBe(false);
  });
});
