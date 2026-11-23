import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { SyncTransport, SYNC_TABLES } from './types.js';

export class SupabaseSyncTransport implements SyncTransport {
  constructor(private supabase: SupabaseClient) {}

  async push(
    table: string,
    rows: unknown[],
  ): Promise<{ accepted: number; errors?: Array<{ id: string; error: string }> }> {
    if (!SYNC_TABLES.includes(table as (typeof SYNC_TABLES)[number])) {
      throw new Error(`Invalid table: ${table}`);
    }
    if (!Array.isArray(rows) || rows.length > 200) {
      throw new Error('Rows must be an array of at most 200 items');
    }

    const { data, error } = await this.supabase.rpc('sync_push', {
      p_table: table,
      p_rows: rows,
    });

    if (error) {
      throw new Error(error.message || 'Sync push failed');
    }

    if (data !== rows.length) throw new Error('Unexpected cloud acknowledgement. Check for an app update before retrying.');
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

    return z.array(z.record(z.string(), z.unknown())).max(limit).parse(data);
  }
}
