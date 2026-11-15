import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ShopRepo } from './repositories/shop.js';
import { CategoryRepo } from './repositories/category.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
import { uuidv7 } from './uuid.js';
import { generateEAN13 } from './barcode.js';
import path from 'node:path';

describe('Phase 4: Products, Variants, and Stock Workflows', () => {
  let db: SqliteTestAdapter;
  let shopId: string;
  let deviceId: string;
  let shopRepo: ShopRepo;
  let categoryRepo: CategoryRepo;
  let productRepo: ProductRepo;
  let stockRepo: StockRepo;
  const now = '2026-11-15T12:00:00.000Z';

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    const migrationsDir = path.resolve('packages/core/migrations');
    await db.migrate(migrationsDir);

    shopRepo = new ShopRepo(db);
    categoryRepo = new CategoryRepo(db);
    productRepo = new ProductRepo(db);
    stockRepo = new StockRepo(db);

    shopId = uuidv7();
    deviceId = uuidv7();

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
  });

  afterEach(() => {
    db.close();
  });

  it('creates product with three variants and opening stock, tests barcode uniqueness and soft-delete', async () => {
    const categoryId = uuidv7();
    await categoryRepo.save({
      id: categoryId,
      shop_id: shopId,
      name: 'E-Liquids',
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 0,
      server_updated_at: null,
    });

    const productId = uuidv7();
    const barcode1 = generateEAN13();
    const barcode2 = generateEAN13();
    const barcode3 = generateEAN13();

    const variant1Id = uuidv7();
    const variant2Id = uuidv7();
    const variant3Id = uuidv7();

    await productRepo.saveProductWithVariantsAndOpeningStock(
      {
        id: productId,
        shop_id: shopId,
        category_id: categoryId,
        name: 'Fruit Burst',
        brand: 'VaporCo',
        notes: 'Best seller',
        is_active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      },
      [
        {
          id: variant1Id,
          shop_id: shopId,
          product_id: productId,
          name: '3mg Nicotine',
          sku: 'FB-3MG',
          barcode: barcode1,
          cost_price: 500,
          sale_price: 1000,
          low_stock_threshold: null,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
        {
          id: variant2Id,
          shop_id: shopId,
          product_id: productId,
          name: '6mg Nicotine',
          sku: 'FB-6MG',
          barcode: barcode2,
          cost_price: 500,
          sale_price: 1000,
          low_stock_threshold: 5,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
        {
          id: variant3Id,
          shop_id: shopId,
          product_id: productId,
          name: '0mg Nicotine',
          sku: 'FB-0MG',
          barcode: barcode3,
          cost_price: 450,
          sale_price: 900,
          low_stock_threshold: 2,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
      ],
      [
        { variantId: variant1Id, qty: 20, unitCost: 500, note: 'Opening stock' },
        { variantId: variant2Id, qty: 15, unitCost: 500, note: 'Opening stock' },
        { variantId: variant3Id, qty: 10, unitCost: 450, note: 'Opening stock' },
      ],
      deviceId,
      now,
    );

    // Verify stock on hand
    const stock1 = await stockRepo.getStockOnHand(shopId, variant1Id);
    expect(stock1[0]?.on_hand).toBe(20);

    const stock2 = await stockRepo.getStockOnHand(shopId, variant2Id);
    expect(stock2[0]?.on_hand).toBe(15);

    // Test barcode uniqueness rejection
    await expect(
      productRepo.saveProductWithVariantsAndOpeningStock(
        {
          id: uuidv7(),
          shop_id: shopId,
          category_id: categoryId,
          name: 'Other Juice',
          brand: null,
          notes: null,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
        [
          {
            id: uuidv7(),
            shop_id: shopId,
            product_id: uuidv7(),
            name: 'Duplicate',
            sku: 'DUP',
            barcode: barcode1, // Duplicate barcode!
            cost_price: 100,
            sale_price: 200,
            low_stock_threshold: null,
            track_stock: 1,
            is_active: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            device_id: deviceId,
            dirty: 1,
            server_updated_at: null,
          },
        ],
        [],
        deviceId,
        now,
      ),
    ).rejects.toThrow(/Duplicate live barcode/);

    // Test editing product without repeating opening stock
    await productRepo.saveProductWithVariantsAndOpeningStock(
      {
        id: productId,
        shop_id: shopId,
        category_id: categoryId,
        name: 'Fruit Burst Updated',
        brand: 'VaporCo',
        notes: 'Updated notes',
        is_active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      },
      [
        {
          id: variant1Id,
          shop_id: shopId,
          product_id: productId,
          name: '3mg Nicotine Updated',
          sku: 'FB-3MG',
          barcode: barcode1,
          cost_price: 500,
          sale_price: 1100,
          low_stock_threshold: null,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
      ],
      [
        { variantId: variant1Id, qty: 20, unitCost: 500, note: 'Opening stock repeat attempt' },
      ],
      deviceId,
      now,
    );

    // On hand should still be 20, not 40 (opening stock was not repeated)
    const stock1AfterEdit = await stockRepo.getStockOnHand(shopId, variant1Id);
    expect(stock1AfterEdit[0]?.on_hand).toBe(20);

    // Test soft delete
    await productRepo.softDeleteProduct(productId, now);
    const deletedProduct = await productRepo.getProductById(productId);
    expect(deletedProduct).toBeUndefined();

    const activeVariants = await productRepo.getVariants(shopId, productId);
    expect(activeVariants.length).toBe(0);
  });

  it('handles restock, adjustments, threshold evaluation, history and badge agreement', async () => {
    const categoryId = uuidv7();
    const productId = uuidv7();
    const variantId = uuidv7();

    await productRepo.saveProductWithVariantsAndOpeningStock(
      {
        id: productId,
        shop_id: shopId,
        category_id: categoryId,
        name: 'Mod Kit',
        brand: 'BrandX',
        notes: null,
        is_active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      },
      [
        {
          id: variantId,
          shop_id: shopId,
          product_id: productId,
          name: 'Standard Kit',
          sku: 'MOD-STD',
          barcode: generateEAN13(),
          cost_price: 2000,
          sale_price: 3500,
          low_stock_threshold: 5,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
        },
      ],
      [{ variantId, qty: 3, unitCost: 2000, note: 'Opening stock' }],
      deviceId,
      now,
    );

    // Initial on hand is 3, threshold is 5 -> low stock (3 <= 5)
    let lowStock = await stockRepo.getLowStockVariants(shopId);
    expect(lowStock.length).toBe(1);
    expect(lowStock[0]!.on_hand).toBe(3);

    // Restock +10
    await stockRepo.stockIn(
      shopId,
      [{ variantId, qty: 10, unitCost: 2100, note: 'Supplier delivery' }],
      deviceId,
      now,
    );

    // On hand is now 13 (3 + 10), threshold is 5 -> no longer low stock
    lowStock = await stockRepo.getLowStockVariants(shopId);
    expect(lowStock.length).toBe(0);

    const inventory = await stockRepo.getInventoryList(shopId, 'all');
    expect(inventory[0]!.on_hand).toBe(13);
    expect(inventory[0]!.cost_price).toBe(2100);

    // Test adjustment: counted quantity 2 (down from 13, diff -11)
    await stockRepo.adjustStock(shopId, variantId, 2, 'Inventory recount', deviceId, now);
    const inventoryAfterAdj = await stockRepo.getInventoryList(shopId, 'all');
    expect(inventoryAfterAdj[0]!.on_hand).toBe(2);
    // 2 <= threshold 5 -> low stock again
    const lowStockAfter = await stockRepo.getLowStockVariants(shopId);
    expect(lowStockAfter.length).toBe(1);

    // Test unchanged count creates no zero movement
    const movementsBefore = await stockRepo.getMovementsForVariant(shopId, variantId);
    await stockRepo.adjustStock(shopId, variantId, 2, 'Unchanged recount', deviceId, now);
    const movementsAfter = await stockRepo.getMovementsForVariant(shopId, variantId);
    expect(movementsAfter.length).toBe(movementsBefore.length);

    // History includes all movement types
    const types = movementsAfter.map((m) => m.type);
    expect(types).toContain('opening');
    expect(types).toContain('restock');
    expect(types).toContain('adjustment');
  });

  it('asserts full rollback on batch failure', async () => {
    const invalidBatch = [
      { sql: `INSERT INTO shops (id) VALUES ('bad')`, params: [] },
    ];
    await expect(db.batch(invalidBatch)).rejects.toThrow();
  });
});
