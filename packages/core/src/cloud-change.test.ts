import { expect, it, vi } from 'vitest';
import { probeConnection, switchConnection } from './cloud-change.js';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';

it.each([
  [401, 'This key was rejected'],
  [404, 'This database is not set up yet'],
  [503, 'Cannot reach this project'],
] as const)('classifies %s', async (status, message) => {
  await expect(
    probeConnection(
      'https://example.invalid',
      'sb_publishable_fixture',
      async () =>
        new Response(status === 404 ? JSON.stringify({ code: 'PGRST202' }) : '', { status }),
    ),
  ).rejects.toThrow(message);
});
it.each([
  'sb_secret_fixture',
  'e30.' + btoa(JSON.stringify({ role: 'service_role' })) + '.fixture',
])('rejects privileged input before network', async (key) => {
  const request = vi.fn();
  await expect(probeConnection('https://example.invalid', key, request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each(['keep', 'backup', 'delete', 'cancel', 'failure'] as const)(
  'handles %s atomically',
  async (mode) => {
    const db = new SqliteTestAdapter();
    await db.migrate();
    try {
      await db.query(
        "INSERT INTO settings VALUES('cloud_enrolled_shop_id','old'),('supabase_url','old-url'),('receipt_counter','42')",
      );
      await db.query(
        "INSERT INTO shops(id,shop_id,name,created_at,updated_at,device_id) VALUES('s','s','Shop','t','t','d')",
      );
      await db.query(
        "INSERT INTO products(id,shop_id,name,created_at,updated_at,device_id,dirty) VALUES('p','s','Pod','t','t','d',0)",
      );
      const backup = vi.fn(async () => {
        if (mode === 'failure') throw Error('backup failed');
        return '/backups/test';
      });
      const task = switchConnection(
        db,
        'new-url',
        'new-key',
        mode === 'failure' ? 'backup' : mode,
        backup,
        mode === 'delete' ? 'DELETE' : '',
      );
      if (mode === 'failure') await expect(task).rejects.toThrow();
      else await task;
      const settings = Object.fromEntries(
        (await db.query<{ key: string; value: string }>('SELECT * FROM settings')).map((r) => [
          r.key,
          r.value,
        ]),
      );
      const unchanged = mode === 'cancel' || mode === 'failure';
      expect(await db.query('SELECT dirty FROM products')).toEqual(
        unchanged ? [{ dirty: 0 }] : mode === 'keep' ? [{ dirty: 1 }] : [],
      );
      expect(settings.supabase_url).toBe(unchanged ? 'old-url' : 'new-url');
      expect(settings.receipt_counter).toBe(unchanged || mode === 'keep' ? '42' : undefined);
      expect(settings.cloud_enrolled_shop_id).toBe(unchanged ? 'old' : undefined);
      expect(backup).toHaveBeenCalledTimes(['keep', 'backup', 'failure'].includes(mode) ? 1 : 0);
    } finally {
      db.close();
    }
  },
);

it('rejects an invalid URL and an unreachable hostname', async () => {
  const fail = vi.fn(async () => {
    throw Error('offline');
  });
  for (const url of ['not a url', 'https://unreachable.invalid'])
    await expect(probeConnection(url, 'sb_publishable_fixture', fail)).rejects.toThrow(
      'Cannot reach this project',
    );
  expect(fail).toHaveBeenCalledTimes(1);
});

it('distinguishes a wrong host from an uninstalled protocol and accepts the current schema', async () => {
  await expect(
    probeConnection(
      'https://wrong.invalid',
      'sb_publishable_fixture',
      async () => new Response('Page not found', { status: 404 }),
    ),
  ).rejects.toThrow('Cannot reach this project');
  await expect(
    probeConnection(
      'https://example.invalid',
      'sb_publishable_fixture',
      async () => new Response('2'),
    ),
  ).resolves.toBeUndefined();
});
it('rolls back a fresh start if the final credential write fails', async () => {
  const db = new SqliteTestAdapter();
  await db.migrate();
  try {
    await db.query("INSERT INTO settings VALUES('supabase_url','old'),('receipt_counter','40')");
    await db.query(
      "CREATE TRIGGER fail_settings BEFORE INSERT ON settings WHEN NEW.key='supabase_anon_key' BEGIN SELECT RAISE(ABORT,'write interrupted'); END",
    );
    await expect(
      switchConnection(db, 'new', 'key', 'delete', async () => '', 'DELETE'),
    ).rejects.toThrow('write interrupted');
    expect(await db.query("SELECT value FROM settings WHERE key='receipt_counter'")).toEqual([
      { value: '40' },
    ]);
    expect(await db.query("SELECT value FROM settings WHERE key='supabase_url'")).toEqual([
      { value: 'old' },
    ]);
    await expect(
      switchConnection(db, 'new', 'key', 'delete', async () => '', 'delete'),
    ).rejects.toThrow('Type DELETE');
  } finally {
    db.close();
  }
});
