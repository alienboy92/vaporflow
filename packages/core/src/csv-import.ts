import Papa from 'papaparse';
import { z } from 'zod';
import { DbAdapter } from './db-adapter.js';
import { ProductRepo } from './repositories/product.js';
import { CategoryRepo } from './repositories/category.js';
import { uuidv7 } from './uuid.js';
import { Variant } from './types/schemas.js';

export const CsvRowInputSchema = z.object({
  category: z.string().optional().default('General'),
  product_name: z.string().min(1, 'Product name is required'),
  variant_name: z.string().optional().default('Default'),
  barcode: z.string().optional().nullable().transform((v) => (v ? String(v).trim() : null)),
  sku: z.string().optional().nullable().transform((v) => (v ? String(v).trim() : null)),
  cost_price: z.union([z.string(), z.number()]).transform((val) => {
    const s = String(val ?? '').trim();
    if (!s) throw new Error('Cost price is required');
    const n = Number(s);
    if (isNaN(n) || n < 0) throw new Error('Invalid cost price');
    return Math.round(n);
  }),
  sale_price: z.union([z.string(), z.number()]).transform((val) => {
    const s = String(val ?? '').trim();
    if (!s) throw new Error('Sale price is required');
    const n = Number(s);
    if (isNaN(n) || n < 0) throw new Error('Invalid sale price');
    return Math.round(n);
  }),
  opening_stock: z.union([z.string(), z.number()]).optional().default(0).transform((val) => {
    const s = String(val ?? '').trim();
    if (!s) return 0;
    const n = Number(s);
    if (isNaN(n) || !Number.isInteger(n) || n < 0) throw new Error('Opening stock must be a non-negative integer');
    return n;
  }),
  low_stock_threshold: z.union([z.string(), z.number()]).optional().nullable().transform((val) => {
    const s = String(val ?? '').trim();
    if (!s) return null;
    const n = Number(s);
    if (isNaN(n) || !Number.isInteger(n) || n < 0) throw new Error('Low stock threshold must be a non-negative integer');
    return Math.round(n);
  }),
});

export type CsvRowParsed = z.infer<typeof CsvRowInputSchema>;

export interface ImportPreviewRow {
  rowNumber: number;
  data: CsvRowParsed;
  errors: string[];
  isDuplicateBarcodeInFile: boolean;
  isDuplicateBarcodeInDb: boolean;
  /** How the row matched an existing variant, when it did. */
  matchBy?: 'barcode' | 'name';
  existingVariantId?: string;
  existingProductId?: string;
}

export interface ImportResult {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
}

export const CSV_TEMPLATE_HEADERS = [
  'category',
  'product_name',
  'variant_name',
  'barcode',
  'sku',
  'cost_price',
  'sale_price',
  'opening_stock',
  'low_stock_threshold',
];

export function generateCsvTemplate(): string {
  return [
    CSV_TEMPLATE_HEADERS.join(','),
    'Vapes,Disposable Vape 5000,Blueberry Ice,8901234567890,DISP-BLU,1200,1800,50,3',
    'Accessories,USB-C Cable 1m,White,,CBL-WHT,150,350,100,5',
  ].join('\n');
}

export async function previewCsvImport(
  db: DbAdapter,
  shopId: string,
  csvText: string,
): Promise<{ rows: ImportPreviewRow[]; globalErrors: string[] }> {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const globalErrors: string[] = [];
  if (parsed.errors && parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      globalErrors.push(`CSV Parse Error at row ${err.row ?? 'unknown'}: ${err.message}`);
    }
  }

  const productRepo = new ProductRepo(db);
  const categoryRepo = new CategoryRepo(db);
  const existingVariants = await productRepo.getVariants(shopId);
  const barcodeToVariant = new Map<string, Variant>();
  for (const v of existingVariants) {
    if (v.barcode) {
      barcodeToVariant.set(v.barcode.trim(), v);
    }
  }

  // Name-based matching needs the same grouping executeCsvImport uses, so the
  // preview can flag exactly the rows that will be treated as existing.
  const categoryMap = new Map<string, string>(); // lowercased name -> id
  for (const c of await categoryRepo.getAll(shopId)) {
    categoryMap.set(c.name.toLowerCase().trim(), c.id);
  }
  const productMap = new Map<string, string>(); // `${categoryId}:${lower name}` -> id
  for (const p of await productRepo.getProducts(shopId)) {
    productMap.set(`${p.category_id || ''}:${p.name.toLowerCase().trim()}`, p.id);
  }
  const productVariantMap = new Map<string, Variant>(); // `${productId}:${lower variant name}` -> variant
  for (const v of existingVariants) {
    productVariantMap.set(`${v.product_id}:${v.name.toLowerCase().trim()}`, v);
  }

  const seenBarcodesInFile = new Set<string>();
  const rows: ImportPreviewRow[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    const rowNumber = i + 2; // header is row 1
    const rowErrors: string[] = [];
    let parsedData: CsvRowParsed;
    let isDuplicateBarcodeInFile = false;
    let isDuplicateBarcodeInDb = false;
    let matchBy: 'barcode' | 'name' | undefined;
    let existingVariantId: string | undefined;
    let existingProductId: string | undefined;

    try {
      const result = CsvRowInputSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          rowErrors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
        const fallbackRaw = raw ?? {};
        parsedData = {
          category: String(fallbackRaw.category || 'General'),
          product_name: String(fallbackRaw.product_name || ''),
          variant_name: String(fallbackRaw.variant_name || 'Default'),
          barcode: fallbackRaw.barcode ? String(fallbackRaw.barcode).trim() : null,
          sku: fallbackRaw.sku ? String(fallbackRaw.sku).trim() : null,
          cost_price: 0,
          sale_price: 0,
          opening_stock: 0,
          low_stock_threshold: null,
        };
      } else {
        parsedData = result.data;
        if (parsedData.barcode) {
          const b = parsedData.barcode.trim();
          if (seenBarcodesInFile.has(b)) {
            isDuplicateBarcodeInFile = true;
            rowErrors.push(`Duplicate barcode '${b}' within CSV file`);
          } else {
            seenBarcodesInFile.add(b);
          }
          if (barcodeToVariant.has(b)) {
            isDuplicateBarcodeInDb = true;
            const matched = barcodeToVariant.get(b)!;
            existingVariantId = matched.id;
            existingProductId = matched.product_id;
            matchBy = 'barcode';
          }
        }
        // Name-based match (no barcode match): same category + product name +
        // variant name. Conflicting barcodes make the match ambiguous and are
        // surfaced as a row error instead of silently rebinding the barcode.
        if (!existingVariantId) {
          const catId = categoryMap.get(parsedData.category.toLowerCase().trim());
          if (catId) {
            const prodId = productMap.get(`${catId}:${parsedData.product_name.toLowerCase().trim()}`);
            if (prodId) {
              const matched = productVariantMap.get(`${prodId}:${parsedData.variant_name.toLowerCase().trim()}`);
              if (matched) {
                matchBy = 'name';
                existingVariantId = matched.id;
                existingProductId = prodId;
                if (parsedData.barcode && matched.barcode && parsedData.barcode !== matched.barcode) {
                  rowErrors.push(
                    `Barcode '${parsedData.barcode}' conflicts with existing variant '${matched.name}' (barcode '${matched.barcode}'). The row matched by product/variant name; edit the CSV to resolve the ambiguity.`,
                  );
                }
              }
            }
          }
        }
      }
    } catch (err) {
      rowErrors.push(err instanceof Error ? err.message : 'Invalid row format');
      const fallbackRaw = raw ?? {};
      parsedData = {
        category: String(fallbackRaw.category || 'General'),
        product_name: String(fallbackRaw.product_name || ''),
        variant_name: String(fallbackRaw.variant_name || 'Default'),
        barcode: null,
        sku: null,
        cost_price: 0,
        sale_price: 0,
        opening_stock: 0,
        low_stock_threshold: null,
      };
    }

    rows.push({
      rowNumber,
      data: parsedData,
      errors: rowErrors,
      isDuplicateBarcodeInFile,
      isDuplicateBarcodeInDb,
      matchBy,
      existingVariantId,
      existingProductId,
    });
  }

  return { rows, globalErrors };
}

export async function executeCsvImport(
  db: DbAdapter,
  shopId: string,
  deviceId: string,
  previewRows: ImportPreviewRow[],
  priceStrategy: 'skip' | 'update',
  onProgress?: (progress: { current: number; total: number }) => void,
): Promise<ImportResult> {
  const categoryRepo = new CategoryRepo(db);
  const productRepo = new ProductRepo(db);

  const categories = await categoryRepo.getAll(shopId);
  const categoryMap = new Map<string, string>(); // name -> id
  for (const c of categories) {
    categoryMap.set(c.name.toLowerCase().trim(), c.id);
  }

  const existingProducts = await productRepo.getProducts(shopId);
  const productMap = new Map<string, string>(); // 'category_id:product_name' -> product_id
  for (const p of existingProducts) {
    productMap.set(`${p.category_id || ''}:${p.name.toLowerCase().trim()}`, p.id);
  }

  const existingVariants = await productRepo.getVariants(shopId);
  const barcodeVariantMap = new Map<string, Variant>();
  const productVariantMap = new Map<string, Variant>(); // 'product_id:variant_name' -> variant
  for (const v of existingVariants) {
    if (v.barcode) barcodeVariantMap.set(v.barcode.trim(), v);
    productVariantMap.set(`${v.product_id}:${v.name.toLowerCase().trim()}`, v);
  }

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const now = new Date().toISOString();
  const validRows = previewRows.filter((r) => r.errors.length === 0);
  const total = validRows.length;

  const CHUNK_SIZE = 200;
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    const maps = [categoryMap, productMap] as const;
    const savedMaps = maps.map((map) => new Map(map));
    const savedBarcodes = new Map(barcodeVariantMap);
    const savedVariants = new Map(productVariantMap);
    const counts = { importedCount, updatedCount, skippedCount };

    const statements: { sql: string; params?: unknown[] }[] = [];

    for (const r of chunk) {
      try {
        const data = r.data;
        const catName = (data.category || 'General').trim();
        const catKey = catName.toLowerCase();
        let catId = categoryMap.get(catKey);

        if (!catId) {
          catId = uuidv7();
          categoryMap.set(catKey, catId);
          statements.push({
            sql: `INSERT INTO categories (id, shop_id, name, sort_order, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            params: [catId, shopId, catName, 0, now, now, deviceId],
          });
        }

        const prodKey = `${catId}:${data.product_name.toLowerCase().trim()}`;
        let prodId = productMap.get(prodKey);

        if (!prodId) {
          prodId = uuidv7();
          productMap.set(prodKey, prodId);
          statements.push({
            sql: `INSERT INTO products (id, shop_id, category_id, name, brand, notes, is_active, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)`,
            params: [prodId, shopId, catId, data.product_name.trim(), null, null, now, now, deviceId],
          });
        }

        let existingVariant: Variant | undefined = undefined;
        if (data.barcode && barcodeVariantMap.has(data.barcode.trim())) {
          existingVariant = barcodeVariantMap.get(data.barcode.trim());
        } else {
          const vKey = `${prodId}:${data.variant_name.toLowerCase().trim()}`;
          if (productVariantMap.has(vKey)) {
            existingVariant = productVariantMap.get(vKey);
          }
        }

        if (existingVariant) {
          if (priceStrategy === 'skip') {
            skippedCount++;
            continue;
          } else {
            // A CSV barcode that differs from the matched variant's own
            // barcode makes the match ambiguous; the preview flags it as a row
            // error, and this guard keeps stale previews from rebinding it.
            if (data.barcode && existingVariant.barcode && data.barcode !== existingVariant.barcode) {
              errors.push(
                `Row ${r.rowNumber}: barcode '${data.barcode}' conflicts with existing variant barcode '${existingVariant.barcode}'; row skipped.`,
              );
              continue;
            }
            updatedCount++;
            // Never null out identity fields the CSV row omits: keep the
            // existing barcode/sku/threshold instead of overwriting with null.
            statements.push({
              sql: `UPDATE variants SET barcode = ?, sku = ?, cost_price = ?, sale_price = ?, low_stock_threshold = ?, updated_at = ?, device_id = ?, dirty = 1 WHERE id = ?`,
              params: [
                data.barcode ?? existingVariant.barcode,
                data.sku ?? existingVariant.sku,
                data.cost_price,
                data.sale_price,
                data.low_stock_threshold ?? existingVariant.low_stock_threshold,
                now,
                deviceId,
                existingVariant.id,
              ],
            });
          }
        } else {
          const variantId = uuidv7();
          importedCount++;
          statements.push({
            sql: `INSERT INTO variants (id, shop_id, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 1)`,
            params: [
              variantId,
              shopId,
              prodId,
              data.variant_name.trim(),
              data.sku || null,
              data.barcode || null,
              data.cost_price,
              data.sale_price,
              data.low_stock_threshold,
              now,
              now,
              deviceId,
            ],
          });

          if (data.opening_stock > 0) {
            const movId = uuidv7();
            statements.push({
              sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, unit_cost, note, occurred_at, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, ?, 'opening', ?, 'CSV Opening Stock', ?, ?, ?, ?, 1)`,
              params: [
                movId,
                shopId,
                variantId,
                data.opening_stock,
                data.cost_price,
                now,
                now,
                now,
                deviceId,
              ],
            });
          }
          const newVar: Variant = {
            id: variantId,
            shop_id: shopId,
            product_id: prodId,
            name: data.variant_name.trim(),
            sku: data.sku || null,
            barcode: data.barcode || null,
            cost_price: data.cost_price,
            sale_price: data.sale_price,
            low_stock_threshold: data.low_stock_threshold,
            track_stock: 1,
            is_active: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            device_id: deviceId,
            dirty: 1,
            server_updated_at: null,
          };
          if (data.barcode) barcodeVariantMap.set(data.barcode.trim(), newVar);
          productVariantMap.set(`${prodId}:${data.variant_name.toLowerCase().trim()}`, newVar);
        }
      } catch (err) {
        errors.push(`Row ${r.rowNumber}: ${err instanceof Error ? err.message : 'Import failed'}`);
      }
    }

    if (statements.length > 0) {
      try {
        await db.batch(statements);
      } catch (err) {
        maps.forEach((map, index) => {
          map.clear();
          savedMaps[index]!.forEach((value, key) => map.set(key, value));
        });
        barcodeVariantMap.clear();
        savedBarcodes.forEach((value, key) => barcodeVariantMap.set(key, value));
        productVariantMap.clear();
        savedVariants.forEach((value, key) => productVariantMap.set(key, value));
        importedCount = counts.importedCount;
        updatedCount = counts.updatedCount;
        skippedCount = counts.skippedCount;
        // Batches are atomic: nothing from this chunk was written. Record the
        // failure and continue with later chunks; re-running the whole import
        // is deterministic because already-written rows match as existing.
        const first = chunk[0]?.rowNumber ?? i + 2;
        const last = chunk[chunk.length - 1]?.rowNumber ?? i + 1 + chunk.length;
        errors.push(
          `Rows ${first}-${last}: chunk failed and wrote nothing (${err instanceof Error ? err.message : 'batch failed'}). Fix the reported rows and import again.`,
        );
      }
    }

    if (onProgress) {
      onProgress({ current: Math.min(i + CHUNK_SIZE, total), total });
    }
  }

  return { importedCount, updatedCount, skippedCount, errors };
}
