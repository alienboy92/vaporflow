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

export function createVaporFlowSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(projectUrl(url), anonKey, {
    auth: {
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
