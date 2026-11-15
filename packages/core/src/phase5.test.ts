import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ShopRepo } from './repositories/shop.js';
import { ProductRepo } from './repositories/product.js';
import { SaleRepo } from './repositories/sale.js';
import { StockRepo } from './repositories/stock.js';
import { uuidv7 } from './uuid.js';
import path from 'node:path';

describe('Phase 5: Offline Checkout, Receipts, and Counter', () => {
  let db: SqliteTestAdapter;
  let shopId: string;
  let deviceId: string;
  let shopRepo: ShopRepo;
  let productRepo: ProductRepo;
  let saleRepo: SaleRepo;
  let stockRepo: StockRepo;
  const now = '2026-11-15T12:00:00.000Z';
  let variantId: string;

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    const migrationsDir = path.resolve('packages/core/migrations');
    await db.migrate(migrationsDir);

    shopRepo = new ShopRepo(db);
    productRepo = new ProductRepo(db);
    saleRepo = new SaleRepo(db);
    stockRepo = new StockRepo(db);

    shopId = uuidv7();
    deviceId = uuidv7();
    variantId = uuidv7();

    const shop = {
      id: shopId,
      shop_id: shopId,
      name: 'Vapor Shop Central',
      address: '123 Main St',
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
      device_id: deviceId,
      dirty: 0,
      server_updated_at: null,
    };

    const device = {
      id: deviceId,
      shop_id: shopId,
      name: 'Main POS',
      code: 'PC1',
      last_seen_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 0,
      server_updated_at: null,
    };

    await shopRepo.saveFirstRun(shop, device);

    const product = {
      id: uuidv7(),
      shop_id: shopId,
      category_id: null,
      name: 'E-Liquid',
      brand: 'VaporCo',
      notes: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    };

    const variant = {
      id: variantId,
      shop_id: shopId,
      product_id: product.id,
      name: 'Menthol 6mg',
      sku: 'MENT-6',
      barcode: '1234567890123',
      cost_price: 500,
      sale_price: 1000,
      low_stock_threshold: 3,
      track_stock: 1,
      is_active: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    };

    await productRepo.saveProductWithVariantsAndOpeningStock(
      product,
      [variant],
      [{ variantId: variant.id, qty: 10, unitCost: 500, note: 'Opening' }],
      deviceId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('increments per-device receipt counter sequentially and generates receipt_no (PC1-000001, PC1-000002)', async () => {
    const saleId1 = uuidv7();
    const itemId1 = uuidv7();
    const movementId1 = uuidv7();

    const res1 = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: now,
        payment_method: 'cash',
        amount_received: 2000,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 2,
            list_price: 1000,
            unit_price: 1000,
          },
        ],
      },
      saleId1,
      [itemId1],
      [movementId1],
      now,
    );

    expect(res1.sale.receipt_no).toBe('PC1-000001');
    expect(res1.sale.total).toBe(2000);

    const saleId2 = uuidv7();
    const itemId2 = uuidv7();
    const movementId2 = uuidv7();

    const res2 = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: now,
        payment_method: 'online',
        amount_received: null,
        discount_amount: 100,
        note: 'Online sale',
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 1,
            list_price: 1000,
            unit_price: 1000,
          },
        ],
      },
      saleId2,
      [itemId2],
      [movementId2],
      now,
    );

    expect(res2.sale.receipt_no).toBe('PC1-000002');
    expect(res2.sale.total).toBe(900);
    expect(res2.sale.discount_amount).toBe(100);

    // Verify stock deduction: 10 - 2 - 1 = 7 on hand
    const onHandRows = await stockRepo.getStockOnHand(shopId, variantId);
    const stock = onHandRows[0]?.on_hand ?? 0;
    expect(stock).toBe(7);
  });

  it('fails batch and consumes no counter number when variant is invalid', async () => {
    const fakeVariantId = uuidv7();
    const saleId = uuidv7();
    const itemId = uuidv7();
    const movementId = uuidv7();

    await expect(
      saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          sold_at: now,
          payment_method: 'cash',
          amount_received: 1000,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: fakeVariantId,
              product_name: 'Ghost',
              variant_name: 'Ghost',
              qty: 1,
              list_price: 1000,
              unit_price: 1000,
            },
          ],
        },
        saleId,
        [itemId],
        [movementId],
        now,
      ),
    ).rejects.toThrow();

    // Check receipt counter is still 0
    const sales = await saleRepo.getSales(shopId);
    expect(sales.length).toBe(0);

    // Now complete a valid sale, should get PC1-000001
    const validRes = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: now,
        payment_method: 'cash',
        amount_received: 1000,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 1,
            list_price: 1000,
            unit_price: 1000,
          },
        ],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );
    expect(validRes.sale.receipt_no).toBe('PC1-000001');
  });

  it('allows sales when stock becomes negative without blocking', async () => {
    // Sell 15 units when stock is only 10
    const saleId = uuidv7();
    const itemId = uuidv7();
    const movementId = uuidv7();

    const res = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: now,
        payment_method: 'cash',
        amount_received: 15000,
        discount_amount: 0,
        note: 'Negative stock sale',
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 15,
            list_price: 1000,
            unit_price: 1000,
          },
        ],
      },
      saleId,
      [itemId],
      [movementId],
      now,
    );

    expect(res.sale.receipt_no).toBe('PC1-000001');
    const onHandRows = await stockRepo.getStockOnHand(shopId, variantId);
    const stock = onHandRows[0]?.on_hand ?? 0;
    expect(stock).toBe(-5);
  });
});
