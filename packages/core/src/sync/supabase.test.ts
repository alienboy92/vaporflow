import { describe, it, expect, vi } from 'vitest';
import { createVaporFlowSupabaseClient, claimShop, SupabaseSyncTransport } from './index.js';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Supabase Client and Transport (Phase 8B)', () => {
  it('creates supabase client with correct options', () => {
    const client = createVaporFlowSupabaseClient('https://example.supabase.co', 'anon-key-123');
    expect(client).toBeDefined();
  });

  it('claims shop via rpc', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as SupabaseClient;
    const res = await claimShop(mockClient, '00000000-0000-7000-0000-000000000001');
    expect(res).toBe(true);
    expect(mockClient.rpc).toHaveBeenCalledWith('claim_shop', {
      p_shop_id: '00000000-0000-7000-0000-000000000001',
    });
  });

  it('pushes rows via transport rpc', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
    } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    const res = await transport.push('categories', [{ id: '1', shop_id: '2', name: 'Cat' }]);
    expect(res).toEqual({ accepted: 2 });
    expect(mockClient.rpc).toHaveBeenCalledWith('sync_push', {
      p_table: 'categories',
      p_rows: [{ id: '1', shop_id: '2', name: 'Cat' }],
    });
  });

  it('pulls rows via transport rpc', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null }),
    } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    const rows = await transport.pull('categories', 'shop-1', null, null, 100);
    expect(rows).toEqual([{ id: '1' }]);
    expect(mockClient.rpc).toHaveBeenCalledWith('sync_pull', {
      p_table: 'categories',
      p_shop_id: 'shop-1',
      p_cursor_updated_at: null,
      p_cursor_id: null,
      p_limit: 100,
    });
  });
});
