import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { SyncTransport, SYNC_TABLES } from './types.js';

export class SupabaseSyncTransport implements SyncTransport {
  constructor(private supabase: SupabaseClient) {}

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  async writeVersioned(table: string, rows: unknown[]) {
    if (!SYNC_TABLES.some((t) => t === table)) throw new Error('Invalid table');
    if (!Array.isArray(rows) || rows.length > 200) throw new Error('Expected at most 200 rows');

    const result = await this.rpc('sync_write_v2', { p_table: table, p_rows: rows });
    const parsed = z
      .array(
        z.object({ status: z.enum(['ok', 'conflict']), row: z.record(z.string(), z.unknown()) }),
      )
      .length(rows.length)
      .safeParse(result);
    if (!parsed.success)
      throw new Error('Unexpected cloud acknowledgement. Check for an app update.');
    return parsed.data;
  }
  manifest(table: string, shop: string, after: string | null, limit: number) {
    return this.rpc('sync_manifest_v2', {
      p_table: table,
      p_shop: shop,
      p_after: after,
      p_limit: limit,
    });
  }
  fetchRows(table: string, shop: string, ids: string[]) {
    return this.rpc('sync_rows_v2', { p_table: table, p_shop: shop, p_ids: ids });
  }
  async push(
    table: string,
    rows: unknown[],
  ): Promise<{ accepted: number; errors?: Array<{ id: string; error: string }> }> {
    const result = await this.writeVersioned(table, rows);
    if (result.some((reply) => reply.status !== 'ok'))
      throw new Error('Cloud conflict needs review.');
    return { accepted: rows.length };
  }

  async pull(
    table: string,
    shopId: string,
    timestamp: string | null,
    id: string | null,
    limit = 500,
  ): Promise<unknown[]> {
    if (!SYNC_TABLES.includes(table as (typeof SYNC_TABLES)[number])) {
      throw new Error(`Invalid table: ${table}`);
    }
    if (limit < 1 || limit > 500) {
      throw new Error('Limit must be between 1 and 500');
    }
    if ((timestamp === null) !== (id === null)) {
      throw new Error('Both cursor timestamp and id must be provided or both null');
    }

    const { data, error } = await this.supabase.rpc('sync_pull', {
      p_table: table,
      p_shop_id: shopId,
      p_cursor_updated_at: timestamp,
      p_cursor_id: id,
      p_limit: limit,
    });

    if (error) {
      throw new Error(error.message || 'Sync pull failed');
    }

    return z.array(z.unknown()).max(limit).parse(data);
  }
}
