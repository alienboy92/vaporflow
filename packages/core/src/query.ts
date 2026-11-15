import type { z } from 'zod';
import type { DbAdapter } from './db-adapter.js';
/** Validate database data before returning it to the domain. */
export async function readRows<T>(
  db: DbAdapter,
  schema: z.ZodType<T>,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return schema.array().parse(await db.query(sql, params));
}
