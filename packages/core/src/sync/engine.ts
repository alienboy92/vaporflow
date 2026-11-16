import { DbAdapter } from '../db-adapter.js';
import { NetworkAdapter } from '../adapters/types.js';
import {
  SYNC_TABLES,
  MUTABLE_TABLES,
  SyncTransport,
  SyncState,
  SyncStatus,
  SyncProblem,
  TableSchemas,
} from './types.js';

export interface SyncEngineOptions {
  clock?: () => Date;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export class SyncEngine {
  private isSyncing = false;
  private queuedSync = false;
  private lastSuccessAt: string | null = null;
  private problems: SyncProblem[] = [];
  private consecutiveFailures = 0;
  private timer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private clock: () => Date;
  private st: typeof setTimeout;
  private ct: typeof clearTimeout;
  private si: typeof setInterval;
  private ci: typeof clearInterval;

  constructor(
    private db: DbAdapter,
    private transport: SyncTransport,
    private network: NetworkAdapter,
    private shopId: string,
    options?: SyncEngineOptions,
  ) {
    this.clock = options?.clock ?? (() => new Date());
    this.st = options?.setTimeout ?? setTimeout;
    this.ct = options?.clearTimeout ?? clearTimeout;
    this.si = options?.setInterval ?? setInterval;
    this.ci = options?.clearInterval ?? clearInterval;
  }

  async start(): Promise<void> {
    this.unsubscribeNetwork = this.network.onChange((online) => {
      if (online) {
        this.trigger('network-reconnected');
      }
    });

    this.timer = this.si(() => {
      if (this.network.isOnline()) {
        this.trigger('interval-30s');
      }
    }, 30000);

    if (this.network.isOnline()) {
      await this.syncNow();
    }
  }

  stop(): void {
    if (this.timer) {
      this.ci(this.timer);
      this.timer = null;
    }
    if (this.debounceTimer) {
      this.ct(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
  }

  trigger(_reason = 'manual'): void {
    if (this.isSyncing) {
      this.queuedSync = true;
      return;
    }
    this.syncNow().catch(() => {});
  }

  saleCompleted(): void {
    if (this.debounceTimer) {
      this.ct(this.debounceTimer);
    }
    this.debounceTimer = this.st(() => {
      this.trigger('post-sale');
    }, 2000);
  }

  async syncNow(): Promise<void> {
    if (!this.network.isOnline()) {
      return;
    }
    if (this.isSyncing) {
      this.queuedSync = true;
      return;
    }

    this.isSyncing = true;
    try {
      await this.pushAll();
      await this.pullAll();

      this.lastSuccessAt = this.clock().toISOString();
      this.consecutiveFailures = 0;
    } catch (err: unknown) {
      this.consecutiveFailures++;
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, this.consecutiveFailures - 1));
      this.st(() => {
        if (this.network.isOnline()) {
          this.trigger('retry-backoff');
        }
      }, backoffMs);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      this.isSyncing = false;
      if (this.queuedSync) {
        this.queuedSync = false;
        this.st(() => {
          this.syncNow().catch(() => {});
        }, 100);
      }
    }
  }

  async getPendingCount(): Promise<number> {
    let total = 0;
    for (const table of SYNC_TABLES) {
      try {
        const rows = await this.db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${table} WHERE shop_id = ? AND dirty = 1`,
          [this.shopId],
        );
        total += rows[0]?.count ?? 0;
      } catch {
        // Table might not exist yet
      }
    }
    return total;
  }

  async getStatus(): Promise<SyncState> {
    const online = this.network.isOnline();
    const pendingCount = await this.getPendingCount();

    let status: SyncStatus = 'synced';
    if (!online) {
      status = 'offline';
    } else if (this.problems.length > 0) {
      status = 'error';
    } else if (pendingCount > 0) {
      status = 'pending';
    }

    return {
      status,
      pendingCount,
      lastSuccessAt: this.lastSuccessAt,
      problems: [...this.problems],
      isSyncing: this.isSyncing,
    };
  }

  getProblems(): SyncProblem[] {
    return [...this.problems];
  }

  clearProblem(table: string, id: string): void {
    this.problems = this.problems.filter((p) => !(p.table === table && p.id === id));
  }

  private async pushAll(): Promise<void> {
    for (const table of SYNC_TABLES) {
      await this.pushTable(table);
    }
  }

  private async pushTable(table: string): Promise<void> {
    let pushing = true;
    while (pushing) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE shop_id = ? AND dirty = 1 LIMIT 200`,
        [this.shopId],
      );
      if (rows.length === 0) {
        break;
      }

      const snapshots = new Map<string, string>();
      for (const row of rows) {
        snapshots.set(String(row.id), String(row.updated_at));
      }

      const result = await this.transport.push(table, rows);

      const rejectedIds = new Set<string>();
      if (result.errors) {
        for (const err of result.errors) {
          rejectedIds.add(err.id);
          const rejectedRow = rows.find((r) => String(r.id) === err.id);
          this.problems = this.problems.filter(
            (p) => !(p.table === table && p.id === err.id),
          );
          this.problems.push({
            table,
            id: err.id,
            error: err.error,
            timestamp: this.clock().toISOString(),
            row: rejectedRow,
          });
        }
      }

      const statements: { sql: string; params?: unknown[] }[] = [];
      const nowIso = this.clock().toISOString();

      for (const row of rows) {
        const id = String(row.id);
        if (rejectedIds.has(id)) {
          continue;
        }

        const originalUpdatedAt = snapshots.get(id);
        const current = await this.db.query<{ dirty: number; updated_at: string }>(
          `SELECT dirty, updated_at FROM ${table} WHERE id = ?`,
          [id],
        );
        if (current[0] && current[0].dirty === 1 && current[0].updated_at === originalUpdatedAt) {
          statements.push({
            sql: `UPDATE ${table} SET dirty = 0, server_updated_at = ? WHERE id = ?`,
            params: [nowIso, id],
          });
        }
      }

      if (statements.length > 0) {
        await this.db.batch(statements);
      }

      if (rows.length < 200) {
        pushing = false;
      }
    }
  }

  private async pullAll(): Promise<void> {
    for (const table of SYNC_TABLES) {
      await this.pullTable(table);
    }
  }

  private async pullTable(table: string): Promise<void> {
    const schema = TableSchemas[table as keyof typeof TableSchemas];
    const mutable = MUTABLE_TABLES.has(table);

    const tsKey = `sync_cursor_${table}_timestamp`;
    const idKey = `sync_cursor_${table}_id`;

    const settingsRows = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN (?, ?)`,
      [tsKey, idKey],
    );
    const settingsMap = new Map<string, string>();
    for (const r of settingsRows) {
      if (r.value !== null) {
        settingsMap.set(r.key, r.value);
      }
    }

    let cursorTs: string | null = settingsMap.get(tsKey) ?? null;
    let cursorId: string | null = settingsMap.get(idKey) ?? null;

    if (cursorTs !== null) {
      const parsedDate = new Date(cursorTs);
      if (!isNaN(parsedDate.getTime())) {
        parsedDate.setTime(parsedDate.getTime() - 5000);
        cursorTs = parsedDate.toISOString();
      }
    }

    let pulling = true;
    while (pulling) {
      const pulled = await this.transport.pull(
        table,
        this.shopId,
        cursorTs,
        cursorId,
        500,
      );
      const incomingRows = pulled as Array<Record<string, unknown>>;
      if (incomingRows.length === 0) {
        break;
      }

      const statements: { sql: string; params?: unknown[] }[] = [];
      let lastServerUpdatedAt = cursorTs;
      let lastId = cursorId;

      for (const rawRow of incomingRows) {
        let validated: Record<string, unknown>;
        try {
          validated = schema.parse(rawRow) as Record<string, unknown>;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.problems.push({
            table,
            id: String(rawRow.id ?? 'unknown'),
            error: `Validation error: ${message}`,
            timestamp: this.clock().toISOString(),
            row: rawRow,
          });
          continue;
        }

        const id = String(validated.id);
        const serverUpdatedAt = String(validated.server_updated_at);

        const local = await this.db.query<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE id = ?`,
          [id],
        );

        if (mutable) {
          if (
            local.length > 0 &&
            Number(local[0]?.dirty) === 1 &&
            String(local[0]?.updated_at) > String(validated.updated_at)
          ) {
            lastServerUpdatedAt = serverUpdatedAt;
            lastId = id;
            continue;
          }
        }

        const stmt = getTableUpsertStatement(table, validated, serverUpdatedAt);
        statements.push(stmt);

        lastServerUpdatedAt = serverUpdatedAt;
        lastId = id;
      }

      if (lastServerUpdatedAt && lastId) {
        statements.push({
          sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
          params: [tsKey, lastServerUpdatedAt, lastServerUpdatedAt],
        });
        statements.push({
          sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
          params: [idKey, lastId, lastId],
        });
      }

      if (statements.length > 0) {
        try {
          await this.db.batch(statements);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const conflictingId = lastId ?? String(incomingRows[incomingRows.length - 1]?.id ?? 'unknown');
          this.problems.push({
            table,
            id: conflictingId,
            error: `Pull apply failed: ${message}`,
            timestamp: this.clock().toISOString(),
            row: incomingRows.find((r) => String(r.id) === conflictingId),
          });
          break;
        }
      }

      cursorTs = lastServerUpdatedAt;
      cursorId = lastId;

      if (incomingRows.length < 500) {
        pulling = false;
      }
    }
  }
}

function getTableUpsertStatement(
  table: string,
  r: Record<string, unknown>,
  serverUpdatedAt: string,
): { sql: string; params?: unknown[] } {
  const b = (v: unknown) => (v ? 1 : 0);

  switch (table) {
    case 'shops':
      return {
        sql: `INSERT INTO shops (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, address, phone, logo_base64, show_logo_on_receipt, currency_code, currency_decimals, receipt_footer, default_low_stock_threshold)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, address = excluded.address, phone = excluded.phone, logo_base64 = excluded.logo_base64, show_logo_on_receipt = excluded.show_logo_on_receipt,
                currency_code = excluded.currency_code, currency_decimals = excluded.currency_decimals, receipt_footer = excluded.receipt_footer, default_low_stock_threshold = excluded.default_low_stock_threshold,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.address ?? null, r.phone ?? null, r.logo_base64 ?? null, b(r.show_logo_on_receipt),
          r.currency_code, r.currency_decimals, r.receipt_footer, r.default_low_stock_threshold,
          serverUpdatedAt,
        ],
      };
    case 'devices':
      return {
        sql: `INSERT INTO devices (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, code, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, code = excluded.code, last_seen_at = excluded.last_seen_at,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.code, r.last_seen_at ?? null,
          serverUpdatedAt,
        ],
      };
    case 'categories':
      return {
        sql: `INSERT INTO categories (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, sort_order = excluded.sort_order,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.sort_order,
          serverUpdatedAt,
        ],
      };
    case 'products':
      return {
        sql: `INSERT INTO products (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, category_id, name, brand, notes, is_active)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                category_id = excluded.category_id, name = excluded.name, brand = excluded.brand, notes = excluded.notes, is_active = excluded.is_active,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.category_id ?? null, r.name, r.brand ?? null, r.notes ?? null, b(r.is_active),
          serverUpdatedAt,
        ],
      };
    case 'variants':
      return {
        sql: `INSERT INTO variants (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                product_id = excluded.product_id, name = excluded.name, sku = excluded.sku, barcode = excluded.barcode,
                cost_price = excluded.cost_price, sale_price = excluded.sale_price, low_stock_threshold = excluded.low_stock_threshold,
                track_stock = excluded.track_stock, is_active = excluded.is_active,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.product_id, r.name, r.sku ?? null, r.barcode ?? null, r.cost_price, r.sale_price,
          r.low_stock_threshold ?? null, b(r.track_stock), b(r.is_active),
          serverUpdatedAt,
        ],
      };
    case 'expenses':
      return {
        sql: `INSERT INTO expenses (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, expense_date, amount, category, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                expense_date = excluded.expense_date, amount = excluded.amount, category = excluded.category, note = excluded.note,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.expense_date, r.amount, r.category, r.note ?? null,
          serverUpdatedAt,
        ],
      };
    case 'stock_movements':
      return {
        sql: `INSERT INTO stock_movements (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.variant_id, r.qty_change, r.type, r.ref_type ?? null, r.ref_id ?? null, r.unit_cost ?? null, r.note ?? null, r.occurred_at,
        ],
      };
    case 'sales':
      return {
        sql: `INSERT INTO sales (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, receipt_no, sold_at, subtotal, discount_amount, total, payment_method, amount_received, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.receipt_no, r.sold_at, r.subtotal, r.discount_amount, r.total, r.payment_method, r.amount_received ?? null, r.note ?? null,
        ],
      };
    case 'sale_items':
      return {
        sql: `INSERT INTO sale_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, variant_id, product_name, variant_name, qty, list_price, unit_price, unit_cost, net_total)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.sale_id, r.variant_id, r.product_name, r.variant_name, r.qty, r.list_price, r.unit_price, r.unit_cost, r.net_total,
        ],
      };
    case 'returns':
      return {
        sql: `INSERT INTO returns (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, returned_at, refund_amount, refund_method, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.sale_id, r.returned_at, r.refund_amount, r.refund_method, r.note ?? null,
        ],
      };
    case 'return_items':
      return {
        sql: `INSERT INTO return_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost, restocked)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.return_id, r.sale_item_id, r.variant_id, r.qty, r.refund_amount, r.unit_cost, b(r.restocked),
        ],
      };
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}
