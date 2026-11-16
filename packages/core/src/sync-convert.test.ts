/**
 * Unit tests for the PG <-> local wire conversion layer (Phase 8A).
 *
 * The payloads here are shaped like the real Supabase RPC boundary:
 * jsonb_populate_record / to_jsonb(t) booleans, timestamptz strings with
 * offsets and microsecond precision, and no `dirty` column on pulled rows.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeTimestamp,
  toWire,
  wireToLocal,
  storageToWire,
} from './sync/convert.js';
import { ProductSchema, VariantSchema, ReturnItemSchema } from './types/schemas.js';

describe('wire conversion (PG <-> local)', () => {
  it('normalizes timestamps to exactly-3ms UTC', () => {
    expect(normalizeTimestamp('2026-11-15T12:00:00.123456+00:00')).toBe(
      '2026-11-15T12:00:00.123Z',
    );
    expect(normalizeTimestamp('2026-11-15T12:00:00Z')).toBe('2026-11-15T12:00:00.000Z');
    expect(normalizeTimestamp('2026-11-15T17:30:00.999+05:00')).toBe(
      '2026-11-15T12:30:00.999Z',
    );
    expect(normalizeTimestamp('2026-11-15T12:00:00.999999Z')).toBe(
      '2026-11-15T12:00:00.999Z',
    );
    expect(() => normalizeTimestamp(null)).toThrow();
    expect(() => normalizeTimestamp('')).toThrow();
    expect(() => normalizeTimestamp('not-a-date')).toThrow();
    expect(() => normalizeTimestamp(42)).toThrow();
  });

  it('converts a production-shaped PG product row to local shape that passes the schema', () => {
    const pgRow = {
      id: '01923c5e-7c10-7000-8000-000000000001',
      shop_id: '01923c5e-7c10-7000-8000-000000000002',
      created_at: '2026-11-15T12:00:00.123456+00:00',
      updated_at: '2026-11-15T12:00:00.500Z',
      deleted_at: null,
      device_id: '01923c5e-7c10-7000-8000-000000000003',
      category_id: null,
      name: 'Disposable',
      brand: 'BrandX',
      notes: null,
      is_active: true,
      // PG rows carry neither dirty nor... server_updated_at IS present:
      server_updated_at: '2026-11-15T12:00:00.987654+00:00',
    };
    const local = wireToLocal('products', pgRow);
    expect(local.is_active).toBe(1);
    expect(local.created_at).toBe('2026-11-15T12:00:00.123Z');
    expect(local.updated_at).toBe('2026-11-15T12:00:00.500Z');
    expect(local.server_updated_at).toBe('2026-11-15T12:00:00.987Z');
    expect(local.dirty).toBe(0);
    // The result must validate with the local schema unmodified.
    expect(() => ProductSchema.parse(local)).not.toThrow();
  });

  it('converts variant and return-item booleans and validates', () => {
    const base = {
      id: '01923c5e-7c10-7000-8000-00000000000a',
      shop_id: '01923c5e-7c10-7000-8000-000000000002',
      created_at: '2026-11-15T12:00:00Z',
      updated_at: '2026-11-15T12:00:00Z',
      deleted_at: null,
      device_id: '01923c5e-7c10-7000-8000-000000000003',
    };
    const variant = wireToLocal('variants', {
      ...base,
      product_id: '01923c5e-7c10-7000-8000-000000000004',
      name: 'Mint',
      sku: null,
      barcode: '2000000000015',
      cost_price: 100,
      sale_price: 250,
      low_stock_threshold: 3,
      track_stock: true,
      is_active: false,
      server_updated_at: '2026-11-15T12:00:00Z',
    });
    expect(variant.track_stock).toBe(1);
    expect(variant.is_active).toBe(0);
    expect(() => VariantSchema.parse(variant)).not.toThrow();

    const returnItem = wireToLocal('return_items', {
      ...base,
      return_id: '01923c5e-7c10-7000-8000-000000000005',
      sale_item_id: '01923c5e-7c10-7000-8000-000000000006',
      variant_id: '01923c5e-7c10-7000-8000-000000000004',
      qty: 1,
      refund_amount: 250,
      unit_cost: 100,
      restocked: true,
      server_updated_at: '2026-11-15T12:00:00Z',
    });
    expect(returnItem.restocked).toBe(1);
    expect(() => ReturnItemSchema.parse(returnItem)).not.toThrow();
  });

  it('rejects invalid boolean and timestamp values instead of silently coercing', () => {
    expect(() =>
      wireToLocal('products', { is_active: 'yes' }),
    ).toThrow(/Invalid boolean value for is_active/);
    expect(() => wireToLocal('products', { created_at: 'garbage' })).toThrow(/Invalid timestamp/);
  });

  it('toWire drops dirty/server_updated_at and emits PG booleans', () => {
    const local = {
      id: '01923c5e-7c10-7000-8000-00000000000a',
      shop_id: '01923c5e-7c10-7000-8000-000000000002',
      created_at: '2026-11-15T12:00:00.000Z',
      updated_at: '2026-11-15T12:00:00.000Z',
      deleted_at: null,
      device_id: '01923c5e-7c10-7000-8000-000000000003',
      dirty: 1,
      server_updated_at: '2026-11-15T12:30:00.000Z',
      category_id: null,
      name: 'Disposable',
      brand: null,
      notes: null,
      is_active: 0,
    };
    const wire = toWire('products', local);
    expect('dirty' in wire).toBe(false);
    expect('server_updated_at' in wire).toBe(false);
    expect(wire.is_active).toBe(false);
    expect(wire.created_at).toBe('2026-11-15T12:00:00.000Z');
  });

  it('storageToWire mirrors to_jsonb(t): no dirty, PG booleans', () => {
    const stored = {
      id: '01923c5e-7c10-7000-8000-00000000000a',
      shop_id: '01923c5e-7c10-7000-8000-000000000002',
      created_at: '2026-11-15T12:00:00.000Z',
      updated_at: '2026-11-15T12:00:00.000Z',
      deleted_at: null,
      device_id: '01923c5e-7c10-7000-8000-000000000003',
      dirty: 0,
      server_updated_at: '2026-11-15T12:30:00.000Z',
      category_id: null,
      name: 'Disposable',
      brand: null,
      notes: null,
      is_active: 1,
    };
    const wire = storageToWire('products', stored);
    expect('dirty' in wire).toBe(false);
    expect(wire.is_active).toBe(true);
    expect(wire.server_updated_at).toBe('2026-11-15T12:30:00.000Z');
  });
});
