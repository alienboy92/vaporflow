import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export function projectUrl(input: string): string {
  const parsed = z.string().url().safeParse(input.trim());
  if (!parsed.success) throw new Error('Enter a valid Supabase project URL.');
  const url = new URL(parsed.data);
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) {
    throw new Error('Enter an HTTPS Supabase project URL without credentials, query or fragment.');
  }
  url.pathname = url.pathname.replace(/\/rest\/v1\/?$/, '/');
  return url.href.replace(/\/$/, '');
}

export function publicClientKey(input: string): string {
  const key = input.trim();
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
  const jwt = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(key);
  if (jwt?.[1]) {
    try {
      const payload: unknown = JSON.parse(atob(jwt[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (z.object({ role: z.literal('anon') }).safeParse(payload).success) return key;
    } catch { /* Malformed credentials are rejected below. */ }
  }
  throw new Error('Enter a Supabase publishable key or legacy anon key.');
}

export function createVaporFlowSupabaseClient(url: string, anonKey: string, storageKey?: string): SupabaseClient {
  return createClient(projectUrl(url), publicClientKey(anonKey), {
    auth: {
      ...(storageKey ? {storageKey} : {}),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function claimShop(supabase: SupabaseClient, shopId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_shop', { p_shop_id: shopId });
  if (error) {
    throw new Error(error.message || 'Failed to claim shop');
  }
  return Boolean(data);
}
