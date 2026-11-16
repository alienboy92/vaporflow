import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createVaporFlowSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
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
