import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ShopRepo } from './repositories/shop.js';
import { CategoryRepo } from './repositories/category.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
import { uuidv7 } from './uuid.js';
import { generateEAN13 } from './barcode.js';
import type { Variant } from './types/schemas.js';
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

  const mkProduct = (id: string, name: string) => ({
    id,
    shop_id: shopId,
    category_id: null,
    name,
    brand: null,
    notes: null,
    is_active: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: deviceId,
    dirty: 1,
    server_updated_at: null,
  });

  const mkVariant = (
    id: string,
    productId: string,
    name: string,
    threshold: number | null,
    overrides: Partial<Variant> = {},
  ): Variant => ({
    id,
    shop_id: shopId,
    product_id: productId,
    name,
    sku: null,
    barcode: generateEAN13(),
    cost_price: 100,
    sale_price: 200,
    low_stock_threshold: threshold,
    track_stock: 1,
    is_active: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: deviceId,
    dirty: 1,
    server_updated_at: null,
    ...overrides,
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

  it('never creates opening stock when editing a variant whose stock came from restocks (F1 regression)', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Probe Product'),
      [mkVariant(variantId, productId, 'Default', null)],
      [], // created with no opening stock
      deviceId,
      now,
    );

    await stockRepo.stockIn(shopId, [{ variantId, qty: 10, note: 'delivery' }], deviceId, now);
    const before = await stockRepo.getStockOnHand(shopId, variantId);
    expect(before[0]!.on_hand).toBe(10);

    // Edit exactly as the UI previously did: resend the current on-hand as "opening" stock.
    await productRepo.saveProductWithVariantsAndOpeningStock(
      { ...mkProduct(productId, 'Probe Product Renamed'), updated_at: now },
      [mkVariant(variantId, productId, 'Default', null)],
      [{ variantId, qty: 10, unitCost: 100, note: 'Opening stock' }],
      deviceId,
      now,
    );

    const after = await stockRepo.getStockOnHand(shopId, variantId);
    expect(after[0]!.on_hand).toBe(10);

    // The only movement must still be the restock; no phantom opening movement.
    const movements = await stockRepo.getMovementsForVariant(shopId, variantId);
    expect(movements.map((m) => m.type)).toEqual(['restock']);
  });

  it('rolls back the whole catalog batch (product, variants, and movements) on a mid-batch failure', async () => {
    const productId = uuidv7();
    const sharedBarcode = generateEAN13();
    // Two variants in the SAME save share a barcode: pre-batch checks pass because
    // neither is persisted yet; the partial unique index must abort mid-batch.
    const v1 = mkVariant(uuidv7(), productId, 'A', null, { barcode: sharedBarcode });
    const v2 = mkVariant(uuidv7(), productId, 'B', null, { barcode: sharedBarcode });

    await expect(
      productRepo.saveProductWithVariantsAndOpeningStock(
        mkProduct(productId, 'Rollback Product'),
        [v1, v2],
        [{ variantId: v1.id, qty: 5, unitCost: 100, note: 'Opening stock' }],
        deviceId,
        now,
      ),
    ).rejects.toThrow();

    // Nothing survived: no product, no variants, no movements.
    expect(await productRepo.getProductById(productId)).toBeUndefined();
    expect(await productRepo.getVariants(shopId)).toHaveLength(0);
    const allMovements = await stockRepo.getMovementsForVariant(shopId, v1.id);
    expect(allMovements).toHaveLength(0);
  });

  it('rejects invalid Stock In rows before writing and leaves stock and cost unchanged', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Validation Product'),
      [mkVariant(variantId, productId, 'Default', null, { cost_price: 700 })],
      [{ variantId, qty: 2, unitCost: 700 }],
      deviceId,
      now,
    );

    const invalidBatches: { qty: number; unitCost?: number }[] = [
      { qty: 0 },
      { qty: -5 },
      { qty: 2.5 },
      { qty: 5, unitCost: -1 },
      { qty: 5, unitCost: 10.5 },
    ];
    for (const item of invalidBatches) {
      await expect(
        stockRepo.stockIn(shopId, [{ variantId, ...item }], deviceId, now),
      ).rejects.toThrow(/must be a (positive|non-negative) integer/);
    }

    const movements = await stockRepo.getMovementsForVariant(shopId, variantId);
    expect(movements).toHaveLength(1); // only the opening movement
    expect(movements[0]!.type).toBe('opening');
    const onHand = await stockRepo.getStockOnHand(shopId, variantId);
    expect(onHand[0]!.on_hand).toBe(2);
  });

  it('Stock In without a purchase price does not change cost_price', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'No Price Update Product'),
      [mkVariant(variantId, productId, 'Default', null, { cost_price: 450 })],
      [{ variantId, qty: 4, unitCost: 450 }],
      deviceId,
      now,
    );
    await stockRepo.stockIn(shopId, [{ variantId, qty: 6, note: 'no price given' }], deviceId, now);
    const inv = await stockRepo.getInventoryList(shopId, 'all');
    expect(inv.find((i) => i.variant_id === variantId)!.cost_price).toBe(450);
    expect(inv.find((i) => i.variant_id === variantId)!.on_hand).toBe(10);
  });

  it('rejects invalid adjustments and enforces the required note', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Adjust Validation Product'),
      [mkVariant(variantId, productId, 'Default', null)],
      [{ variantId, qty: 5, unitCost: 100 }],
      deviceId,
      now,
    );

    await expect(stockRepo.adjustStock(shopId, variantId, -3, 'note', deviceId, now)).rejects.toThrow(
      /non-negative integer/,
    );
    await expect(stockRepo.adjustStock(shopId, variantId, 2.5, 'note', deviceId, now)).rejects.toThrow(
      /non-negative integer/,
    );
    await expect(stockRepo.adjustStock(shopId, variantId, 4, '   ', deviceId, now)).rejects.toThrow(
      /requires a required note/,
    );

    const movements = await stockRepo.getMovementsForVariant(shopId, variantId);
    expect(movements).toHaveLength(1); // only opening; nothing partial written
  });

  it('uses the shop default threshold with equality counting as low', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    // Shop default threshold is 3; variant has no override.
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Default Threshold Product'),
      [mkVariant(variantId, productId, 'Default', null)],
      [{ variantId, qty: 3, unitCost: 100 }],
      deviceId,
      now,
    );
    const low = await stockRepo.getLowStockVariants(shopId);
    const entry = low.find((l) => l.variant_id === variantId);
    expect(entry).toBeDefined();
    expect(entry!.threshold).toBe(3);
    expect(entry!.on_hand).toBe(3);
    expect((await stockRepo.getInventoryList(shopId, 'low')).map((i) => i.variant_id)).toContain(variantId);
    expect((await stockRepo.getInventoryList(shopId, 'out')).map((i) => i.variant_id)).not.toContain(variantId);
  });

  it('reports zero on-hand for variants with no movements and includes them in the Out filter', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'No Movement Product'),
      [mkVariant(variantId, productId, 'Default', 0)],
      [],
      deviceId,
      now,
    );
    expect((await stockRepo.getStockOnHand(shopId, variantId))[0]!.on_hand).toBe(0);
    expect((await stockRepo.getInventoryList(shopId, 'out')).map((i) => i.variant_id)).toContain(variantId);
    // 0 <= threshold 0: matches both Low and Out, but the badge list counts it once.
    const low = await stockRepo.getLowStockVariants(shopId);
    expect(low.filter((l) => l.variant_id === variantId)).toHaveLength(1);
  });

  it('shows negative on-hand in the Negative filter and counts the variant once in the badge list', async () => {
    const productId = uuidv7();
    const variantId = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Negative Product'),
      [mkVariant(variantId, productId, 'Default', 5)],
      [{ variantId, qty: 2, unitCost: 100 }],
      deviceId,
      now,
    );
    // Simulate a future sale movement selling more than on-hand (negative stock never blocks a sale).
    await stockRepo.addMovement({
      id: uuidv7(),
      shop_id: shopId,
      variant_id: variantId,
      qty_change: -5,
      type: 'sale',
      ref_type: 'sale',
      ref_id: uuidv7(),
      unit_cost: null,
      note: null,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });
    expect((await stockRepo.getStockOnHand(shopId, variantId))[0]!.on_hand).toBe(-3);
    expect((await stockRepo.getInventoryList(shopId, 'negative')).map((i) => i.variant_id)).toContain(variantId);
    expect((await stockRepo.getInventoryList(shopId, 'out')).map((i) => i.variant_id)).toContain(variantId);
    // Matches both Low (threshold 5) and Out, but the badge list counts it once.
    const low = await stockRepo.getLowStockVariants(shopId);
    expect(low.filter((l) => l.variant_id === variantId)).toHaveLength(1);
  });

  it('soft-deletes variants removed in the editor inside the same save batch', async () => {
    const productId = uuidv7();
    const v1 = uuidv7();
    const v2 = uuidv7();
    await productRepo.saveProductWithVariantsAndOpeningStock(
      mkProduct(productId, 'Remove Variant Product'),
      [mkVariant(v1, productId, 'Keep', null), mkVariant(v2, productId, 'Drop', null)],
      [
        { variantId: v1, qty: 3, unitCost: 100 },
        { variantId: v2, qty: 7, unitCost: 100 },
      ],
      deviceId,
      now,
    );

    await productRepo.saveProductWithVariantsAndOpeningStock(
      { ...mkProduct(productId, 'Remove Variant Product'), updated_at: now },
      [mkVariant(v1, productId, 'Keep', null)],
      [],
      deviceId,
      now,
      [v2],
    );

    const active = await productRepo.getVariants(shopId, productId);
    expect(active.map((v) => v.id)).toEqual([v1]);
    // Soft delete preserves the historical ledger rows.
    expect((await stockRepo.getMovementsForVariant(shopId, v2)).length).toBeGreaterThan(0);
    const removedRow = await db.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM variants WHERE id = ?`,
      [v2],
    );
    expect(removedRow[0]!.deleted_at).not.toBeNull();
  });

  it('returns filter-chip inventory counts and category names', async () => {
    const categoryId = uuidv7();
    await categoryRepo.save({
      id: categoryId,
      shop_id: shopId,
      name: 'Pod Systems',
      sort_order: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });

    const productId = uuidv7();
    const healthy = uuidv7();
    const low = uuidv7();
    const out = uuidv7();
    const negative = uuidv7();

    await productRepo.saveProductWithVariantsAndOpeningStock(
      { ...mkProduct(productId, 'Pod Kit'), category_id: categoryId },
      [
        mkVariant(healthy, productId, 'Healthy', 5),
        mkVariant(low, productId, 'Low', 5),
        mkVariant(out, productId, 'Out', 5),
        mkVariant(negative, productId, 'Negative', 5),
      ],
      [
        { variantId: healthy, qty: 10, unitCost: 100 },
        { variantId: low, qty: 2, unitCost: 100 },
        { variantId: out, qty: 0, unitCost: 100 },
      ],
      deviceId,
      now,
    );

    // A sale movement can push on-hand below zero; adjustments cannot.
    await stockRepo.addMovement({
      id: uuidv7(),
      shop_id: shopId,
      variant_id: negative,
      qty_change: -2,
      type: 'sale',
      ref_type: 'sale',
      ref_id: uuidv7(),
      unit_cost: null,
      note: null,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });

    const rows = await stockRepo.getInventoryList(shopId, 'all');
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.category_name === 'Pod Systems')).toBe(true);

    // Low excludes out/negative rows, matching the prototype chip semantics.
    expect(await stockRepo.getInventoryCounts(shopId)).toEqual({
      all: 4,
      low: 1,
      out: 2,
      negative: 1,
    });
    expect((await stockRepo.getInventoryList(shopId, 'low')).map((row) => row.variant_id)).toEqual([
      low,
    ]);
  });

  it('asserts full rollback on batch failure', async () => {
    const invalidBatch = [
      { sql: `INSERT INTO shops (id) VALUES ('bad')`, params: [] },
    ];
    await expect(db.batch(invalidBatch)).rejects.toThrow();
  });
});
