import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MIGRATION_FILES } from './cloud-migrations.js';

export const EXPECTED_SCHEMA_VERSION = MIGRATION_FILES.length;
const versionRow = z.object({ value: z.string().regex(/^[1-9]\d*$/) });

export function schemaWarning(row: unknown): string | null {
  const result = versionRow.safeParse(row);
  const version = result.success ? BigInt(result.data.value) : 0n;
  if (version < EXPECTED_SCHEMA_VERSION) return 'Cloud database is outdated. Re-run the setup SQL.';
  if (version > EXPECTED_SCHEMA_VERSION) return 'App is outdated, please update.';
  return null;
}

export async function readCloudSchema(client: SupabaseClient) {
  const { data, error } = await client.from('app_meta').select('value').eq('key', 'schema_version').maybeSingle();
  return schemaWarning(error ? null : data);
}
