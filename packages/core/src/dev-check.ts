import { z } from 'zod';
import type { DbAdapter } from './db-adapter.js';

// Stable fixture IDs make restart verification possible without creating more shops.
const shopId = '01900000-0000-7000-8000-000000000101';
const productId = '01900000-0000-7000-8000-000000000102';
const variantId = '01900000-0000-7000-8000-000000000103';
const deviceId = '01900000-0000-7000-8000-000000000104';
export const DbCheckResultSchema = z.object({
  shopId: z.string(),
  variantId: z.string(),
  productCount: z.number().int(),
  variantCount: z.number().int(),
  readBackName: z.string(),
  exists: z.boolean(),
});
export type DbCheckResult = z.infer<typeof DbCheckResultSchema>;

/** Call only with a separate diagnostics database, never the active shop database. */
export async function readDevelopmentDbCheck(db: DbAdapter): Promise<DbCheckResult> {
  const counts = z
    .array(z.object({ products: z.number().int(), variants: z.number().int() }))
    .parse(
      await db.query(
        'SELECT (SELECT COUNT(*) FROM products WHERE shop_id = ?) AS products, (SELECT COUNT(*) FROM variants WHERE shop_id = ?) AS variants',
        [shopId, shopId],
      ),
    );
  const rows = z
    .array(z.object({ name: z.string() }))
    .parse(await db.query('SELECT name FROM variants WHERE id = ?', [variantId]));
  return DbCheckResultSchema.parse({
    shopId,
    variantId,
    productCount: counts[0]?.products ?? 0,
    variantCount: counts[0]?.variants ?? 0,
    readBackName: rows[0]?.name ?? '',
    exists: rows.length > 0,
  });
}

export async function runDevelopmentDbCheck(db: DbAdapter): Promise<DbCheckResult> {
  await db.migrate();
  const shops = z.array(z.object({ id: z.string() })).parse(await db.query('SELECT id FROM shops'));
  if (shops.some((shop) => shop.id !== shopId))
    throw new Error('Refusing fixture writes: database contains another shop');
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: "INSERT INTO shops(id,shop_id,name,created_at,updated_at,device_id,dirty) VALUES (?,?,'Fixture Shop',?,?,?,0) ON CONFLICT(id) DO NOTHING",
      params: [shopId, shopId, now, now, deviceId],
    },
    {
      sql: "INSERT INTO products(id,shop_id,name,created_at,updated_at,device_id,dirty) VALUES (?,?,'Fixture Product',?,?,?,0) ON CONFLICT(id) DO NOTHING",
      params: [productId, shopId, now, now, deviceId],
    },
    {
      sql: "INSERT INTO variants(id,shop_id,product_id,name,cost_price,sale_price,created_at,updated_at,device_id,dirty) VALUES (?,?,?,'Fixture Variant',100,250,?,?,?,0) ON CONFLICT(id) DO NOTHING",
      params: [variantId, shopId, productId, now, now, deviceId],
    },
  ]);
  return readDevelopmentDbCheck(db);
}
