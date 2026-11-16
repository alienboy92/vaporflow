import { z } from 'zod';
import {
  ShopSchema,
  DeviceSchema,
  CategorySchema,
  ProductSchema,
  VariantSchema,
  ExpenseSchema,
  StockMovementSchema,
  SaleSchema,
  SaleItemSchema,
  ReturnSchema,
  ReturnItemSchema,
} from '../types/schemas.js';

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error';

export interface SyncProblem {
  table: string;
  id: string;
  error: string;
  timestamp: string;
  row?: unknown;
}

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSuccessAt: string | null;
  /** Message of the last failed sync run; null after a successful run. */
  lastError: string | null;
  problems: SyncProblem[];
  isSyncing: boolean;
}

export interface SyncTransport {
  push(
    table: string,
    rows: unknown[],
  ): Promise<{
    accepted: number;
    errors?: Array<{ id: string; error: string }>;
  }>;
  pull(
    table: string,
    shopId: string,
    timestamp: string | null,
    id: string | null,
    limit: number,
  ): Promise<unknown[]>;
}

export const SYNC_TABLES = [
  'shops',
  'devices',
  'categories',
  'products',
  'variants',
  'expenses',
  'stock_movements',
  'sales',
  'sale_items',
  'returns',
  'return_items',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export const MUTABLE_TABLES = new Set<string>([
  'shops',
  'devices',
  'categories',
  'products',
  'variants',
  'expenses',
]);

export const TableSchemas: Record<SyncTable, z.ZodTypeAny> = {
  shops: ShopSchema,
  devices: DeviceSchema,
  categories: CategorySchema,
  products: ProductSchema,
  variants: VariantSchema,
  expenses: ExpenseSchema,
  stock_movements: StockMovementSchema,
  sales: SaleSchema,
  sale_items: SaleItemSchema,
  returns: ReturnSchema,
  return_items: ReturnItemSchema,
};
