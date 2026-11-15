/**
 * @vaporflow/core
 *
 * Domain types, schemas, money math, repositories, reports, sync engine.
 * No UI, no platform code.
 */

export * from './types/index.js';
export * from './money.js';
export * from './uuid.js';
export * from './repositories/category.js';
export * from './repositories/product.js';
export * from './repositories/stock.js';
export * from './repositories/sale.js';
export * from './repositories/return.js';
export * from './repositories/expense.js';
export * from './repositories/report.js';
export * from './repositories/settings.js';

export type { DbAdapter } from './db-adapter.js';
