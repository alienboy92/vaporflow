/**
 * Full local reset used by Settings → Clear Data.
 *
 * The whole schema is dropped in one atomic batch and then recreated from the
 * bundled migrations, which leaves a first-run database without touching the
 * cloud copy or any other device. Shop, catalog, stock, sales, returns,
 * expenses, settings (PIN, cloud credentials, receipt counter) and the local
 * migration history are all removed.
 */
import type { DbAdapter } from './adapters/types.js';

/** Dropped in one batch; migrations recreate every object. */
const RESET_STATEMENTS = [
  'DROP VIEW IF EXISTS v_stock_on_hand',
  'DROP TABLE IF EXISTS return_items',
  'DROP TABLE IF EXISTS returns',
  'DROP TABLE IF EXISTS sale_items',
  'DROP TABLE IF EXISTS sales',
  'DROP TABLE IF EXISTS stock_movements',
  'DROP TABLE IF EXISTS expenses',
  'DROP TABLE IF EXISTS variants',
  'DROP TABLE IF EXISTS products',
  'DROP TABLE IF EXISTS categories',
  'DROP TABLE IF EXISTS devices',
  'DROP TABLE IF EXISTS shops',
  'DROP TABLE IF EXISTS settings',
  'DROP TABLE IF EXISTS _operation_guards',
  'DROP TABLE IF EXISTS _migrations',
] as const;

export async function resetLocalDatabase(db: DbAdapter): Promise<void> {
  await db.batch(RESET_STATEMENTS.map((sql) => ({ sql })));
  await db.migrate();
}
