import { describe, it, expect, vi } from 'vitest';
import { createVaporFlowSupabaseClient, claimShop, SupabaseSyncTransport } from './index.js';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Supabase Client and Transport (Phase 8B)', () => {
  it('creates supabase client with correct options', () => {
    const client = createVaporFlowSupabaseClient('https://example.supabase.co', 'sb_publishable_example');
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
      rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    const res = await transport.push('categories', [{ id: '1', shop_id: '2', name: 'Cat' }]);
    expect(res).toEqual({ accepted: 1 });
    expect(mockClient.rpc).toHaveBeenCalledWith('sync_push', {
      p_table: 'categories',
      p_rows: [{ id: '1', shop_id: '2', name: 'Cat' }],
    });
  });

  it.each([null, 0, 2, '1'])('rejects incompatible push acknowledgement %s', async data => {
    const client = { rpc: vi.fn().mockResolvedValue({ data, error: null }) } as unknown as SupabaseClient;
    await expect(new SupabaseSyncTransport(client).push('sales', [{}])).rejects.toThrow(/acknowledgement/);
  });

  it('rejects malformed pull pages', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } as unknown as SupabaseClient;
    await expect(new SupabaseSyncTransport(client).pull('sales', 'shop', null, null)).rejects.toThrow();
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

  // --- Error paths: the engine's batch-atomic rejection and backoff depend
  // on these throwing instead of returning garbage. ---

  it('push throws when the rpc returns an error', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'push rejected' } }),
    } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    await expect(transport.push('categories', [{ id: '1' }])).rejects.toThrow('push rejected');
  });

  it('pull throws when the rpc returns an error', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'pull rejected' } }),
    } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    await expect(transport.pull('sales', 'shop-1', null, null, 500)).rejects.toThrow('pull rejected');
  });

  it('claimShop throws when the rpc returns an error', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'claim denied by rpc' } }),
    } as unknown as SupabaseClient;
    await expect(claimShop(mockClient, '00000000-0000-7000-0000-000000000001')).rejects.toThrow(
      'claim denied by rpc',
    );
  });

  it('claimShop returns false when the rpc reports no membership', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as unknown as SupabaseClient;
    await expect(claimShop(mockClient, '00000000-0000-7000-0000-000000000001')).resolves.toBe(
      false,
    );
  });

  it('push rejects invalid table names before any rpc call', async () => {
    const mockClient = { rpc: vi.fn() } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    await expect(transport.push('not_a_table', [{ id: '1' }])).rejects.toThrow('Invalid table');
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it('push rejects oversized batches before any rpc call', async () => {
    const mockClient = { rpc: vi.fn() } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    const rows = Array.from({ length: 201 }, () => ({ id: '1' }));
    await expect(transport.push('sales', rows)).rejects.toThrow('at most 200');
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it('pull rejects invalid limits before any rpc call', async () => {
    const mockClient = { rpc: vi.fn() } as unknown as SupabaseClient;
    const transport = new SupabaseSyncTransport(mockClient);
    await expect(transport.pull('sales', 'shop-1', null, null, 501)).rejects.toThrow();
    await expect(transport.pull('sales', 'shop-1', null, null, 0)).rejects.toThrow();
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

});
