import { z } from 'zod';
import type { DbAdapter } from './db-adapter.js';
import { SYNC_TABLES } from './sync/types.js';
import { projectUrl, publicClientKey } from './sync/supabase-client.js';
import { uuidv7 } from './uuid.js';

export type CloudChoice = 'keep' | 'backup' | 'delete' | 'cancel';
export async function probeConnection(url: string, key: string, request = fetch) {
  let endpoint: string;
  try {
    endpoint = projectUrl(url);
  } catch {
    throw Error('Cannot reach this project');
  }
  try {
    key = publicClientKey(key);
  } catch {
    throw Error('This key was rejected');
  }
  let response;
  try {
    response = await request(endpoint + '/rest/v1/rpc/vaporflow_protocol', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw Error('Cannot reach this project');
  }
  if ([401, 403].includes(response.status)) throw Error('This key was rejected');
  if (response.status >= 500) throw Error('Cannot reach this project');
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 404 && !z.object({ code: z.literal('PGRST202') }).safeParse(body).success)
    throw Error('Cannot reach this project');
  if (!response.ok || body !== 2) throw Error('This database is not set up yet');
}
export async function needsCloudChoice(db: DbAdapter) {
  const [row] = await db.query<{ needed: number }>(
    "SELECT EXISTS(SELECT 1 FROM products UNION ALL SELECT 1 FROM sales UNION ALL SELECT 1 FROM settings WHERE key='cloud_enrolled_shop_id') AS needed",
  );
  return Boolean(row?.needed);
}
export function backupName(now = new Date()) {
  const stamp = new Date(now.getTime() + 5 * 3600000).toISOString();
  return 'vaporflow-backup-' + stamp.slice(0, 10) + '-' + stamp.slice(11, 19).replaceAll(':', '');
}
export async function switchConnection(
  db: DbAdapter,
  url: string,
  key: string,
  choice: CloudChoice,
  backup: () => Promise<string>,
  confirmation = '',
) {
  if (choice === 'cancel') return;
  if (choice === 'delete' && confirmation !== 'DELETE') throw Error('Type DELETE to confirm.');
  const [snapshot] = await db.query<{ writes: number; revision: number }>(
    'SELECT total_changes() AS writes,data_version AS revision FROM pragma_data_version',
  );
  const file = choice === 'delete' ? undefined : await backup();
  const statements: { sql: string; params?: unknown[] }[] = [
    {
      sql: "INSERT INTO _operation_guards SELECT 'cloud-change',total_changes()=? AND data_version=? FROM pragma_data_version",
      params: [snapshot!.writes, snapshot!.revision],
    },
    { sql: "DELETE FROM _operation_guards WHERE id='cloud-change'" },
  ];
  if (choice === 'keep') {
    for (const table of SYNC_TABLES)
      statements.push({ sql: `UPDATE ${table} SET dirty=1,server_updated_at=NULL` });
    statements.push({
      sql: "DELETE FROM settings WHERE key GLOB 'cloud_*' OR key GLOB 'sync_cursor_*' OR key='last_sync_at'",
    });
    statements.push({
      sql: "INSERT INTO settings(key,value) SELECT 'cloud_upload_shop',id FROM shops WHERE deleted_at IS NULL LIMIT 1",
    });
  } else {
    // Suspend only the five known ledger delete guards inside this transaction.
    const ledgers = ['stock_movements', 'sales', 'sale_items', 'returns', 'return_items'];
    for (const table of ledgers) statements.push({ sql: `DROP TRIGGER ${table}_immutable_delete` });
    for (const table of [...SYNC_TABLES].reverse())
      statements.push({ sql: 'DELETE FROM ' + table });
    for (const table of ledgers)
      statements.push({
        sql: `CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Ledger rows are immutable'); END`,
      });
    statements.push(
      { sql: 'DELETE FROM settings' },
      { sql: "INSERT INTO settings VALUES('cloud_clear_preferences','1')" },
    );
  }
  statements.push({ sql: 'DELETE FROM sync_versions' }, { sql: 'DELETE FROM sync_attention' });
  for (const pair of [
    ['supabase_url', url],
    ['supabase_anon_key', key],
    ['cloud_session_namespace', uuidv7()],
    ...(file ? [['last_cloud_backup', z.string().min(1).parse(file)]] : []),
  ])
    statements.push({
      sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',
      params: pair,
    });
  await db.batch(statements);
  return file;
}
