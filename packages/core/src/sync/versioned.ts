import { z } from 'zod';
import type { DbAdapter } from '../db-adapter.js';
import { getTableUpsertStatement } from './apply-row.js';
import { toWire, wireToLocal } from './convert.js';
import {
  SYNC_TABLES,
  TableSchemas,
  type SyncTable,
  type SyncProblem,
  type SyncTransport,
} from './types.js';

type Row = Record<string, unknown>;
type Statement = { sql: string; params?: unknown[] };
const object = z.record(z.string(), z.unknown());
const revision = z.number().int().positive().safe();
const remoteId = z.object({ id: z.uuidv7(), row_version: revision });
const cursor = z.object({ id: z.uuidv7(), server_updated_at: z.iso.datetime({ offset: true }) });
const replies = z.array(z.object({ status: z.enum(['ok', 'conflict']), row: object }));
const PAGE = 500;
const keyColumns = 'shop_id=? AND table_name=? AND row_id=?';
const positionKey = (value: string) =>
  new Date(value).toISOString().slice(0, 19) +
  '.' +
  (/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(6, '0');
const setting = (key: string, value: string): Statement => ({
  sql: 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  params: [key, value],
});

export class VersionedSync {
  private lastManifest = -Infinity;
  constructor(
    private db: DbAdapter,
    private transport: SyncTransport,
    private shop: string,
    private now: () => Date = () => new Date(),
  ) {}

  private version(table: SyncTable, id: string, version: number): Statement {
    return {
      sql: 'INSERT INTO sync_versions VALUES(?,?,?,?) ON CONFLICT(shop_id,table_name,row_id) DO UPDATE SET version=max(version,excluded.version)',
      params: [this.shop, table, id, version],
    };
  }
  private attention(
    table: SyncTable,
    row: Row,
    kind: 'conflict' | 'quarantine',
    reason: string,
  ): Statement {
    return {
      sql: `INSERT INTO sync_attention VALUES(?,?,?,?,?,?,?,?) ON CONFLICT
      DO UPDATE SET version=excluded.version,payload=excluded.payload,reason=excluded.reason,received_at=excluded.received_at
      WHERE excluded.version>=sync_attention.version`,
      params: [
        this.shop,
        table,
        String(row.id ?? 'invalid:' + JSON.stringify(row)),
        kind,
        revision.safeParse(row.row_version).data ?? 0,
        JSON.stringify(row),
        reason,
        this.now().toISOString(),
      ],
    };
  }

  async problems(): Promise<SyncProblem[]> {
    const rows = await this.db.query(
      'SELECT * FROM sync_attention WHERE shop_id=? ORDER BY received_at',
      [this.shop],
    );
    return z
      .array(
        z.object({
          table_name: z.enum(SYNC_TABLES),
          row_id: z.string(),
          kind: z.enum(['conflict', 'quarantine']),
          reason: z.string(),
          received_at: z.string(),
          version: z.number(),
          payload: z.string(),
        }),
      )
      .parse(rows)
      .map((r) => ({
        table: r.table_name,
        id: r.row_id,
        kind: r.kind,
        error: r.reason,
        timestamp: r.received_at,
        version: r.version,
        row: JSON.parse(r.payload) as unknown,
      }));
  }

  private decoded(table: SyncTable, row: Row) {
    const { row_version } = remoteId.parse(row);
    const { server_updated_at } = cursor.parse(row);
    const local = TableSchemas[table].parse(wireToLocal(table, row)) as Row;
    if (local.shop_id !== this.shop) throw new Error('Cloud row belongs to another shop');
    return { stmt: getTableUpsertStatement(table, local, server_updated_at), version: row_version };
  }

  private async apply(table: SyncTable, row: Row, after: Statement[] = []) {
    let changes: Statement[];
    try {
      const { stmt, version } = this.decoded(table, row);
      const key = [this.shop, table, row.id];
      // Evaluate both guards inside SQLite so a sale-screen edit between network I/O and commit survives.
      changes = [
        {
          sql: `INSERT INTO sync_attention SELECT ?,?,?,'conflict',?,?,?,?
          WHERE EXISTS (SELECT 1 FROM ${table} WHERE shop_id=? AND id=? AND dirty=1)
          AND ?>COALESCE((SELECT version FROM sync_versions WHERE ${keyColumns}),0)
          ON CONFLICT DO UPDATE SET version=excluded.version,payload=excluded.payload,
          received_at=excluded.received_at WHERE excluded.version>sync_attention.version`,
          params: [
            ...key,
            version,
            JSON.stringify(row),
            'Cloud and local changes need a decision.',
            this.now().toISOString(),
            this.shop,
            row.id,
            version,
            ...key,
          ],
        },
        {
          ...stmt,
          sql:
            stmt.sql +
            ` WHERE ${table}.dirty=0 AND ?>=COALESCE((SELECT version FROM sync_versions WHERE ${keyColumns}),0)`,
          params: [...(stmt.params ?? []), version, ...key],
        },
        {
          sql: `INSERT INTO sync_versions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE shop_id=? AND id=? AND dirty=0)
          ON CONFLICT(shop_id,table_name,row_id) DO UPDATE SET version=max(version,excluded.version)`,
          params: [...key, version, this.shop, row.id],
        },
        {
          sql: `DELETE FROM sync_attention WHERE ${keyColumns} AND kind='quarantine' AND version<=?`,
          params: [...key, version],
        },
      ];
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid cloud data';
      await this.db.batch([this.attention(table, row, 'quarantine', reason), ...after]);
      return;
    }
    try {
      await this.db.batch([...changes, ...after]);
    } catch (e) {
      // A local storage failure also prevents this second transaction from advancing the cursor.
      await this.db.batch([
        this.attention(
          table,
          row,
          'quarantine',
          e instanceof Error ? e.message : 'Local application failed.',
        ),
        ...after,
      ]);
    }
  }

  private async push(table: SyncTable) {
    for (;;) {
      const rows = await this.db.query<Row>(
        `SELECT t.*,COALESCE(v.version,0) AS base_version FROM ${table} t
        LEFT JOIN sync_versions v ON v.shop_id=t.shop_id AND v.table_name=? AND v.row_id=t.id
        WHERE t.shop_id=? AND t.dirty=1 AND NOT EXISTS(SELECT 1 FROM sync_attention a WHERE a.shop_id=t.shop_id
        AND a.table_name=? AND a.row_id=t.id) ORDER BY t.id LIMIT 200`,
        [table, this.shop, table],
      );
      if (!rows.length) return;
      const response = replies.length(rows.length).parse(
        await this.transport.writeVersioned!(
          table,
          rows.map((r) => toWire(table, r)),
        ),
      );
      const changes: Statement[] = [];
      response.forEach((reply, i) => {
        const snapshot = rows[i]!;
        if (reply.row.id !== snapshot.id) throw new Error('Unexpected cloud acknowledgement');
        let decoded;
        try {
          decoded = this.decoded(table, reply.row);
        } catch (error) {
          changes.push(
            this.attention(
              table,
              reply.row,
              'quarantine',
              error instanceof Error ? error.message : 'Invalid cloud acknowledgement',
            ),
          );
          return;
        }
        const { version, stmt } = decoded;
        if (reply.status === 'conflict') {
          changes.push(
            this.attention(
              table,
              reply.row,
              'conflict',
              'Cloud and local changes need a decision.',
            ),
          );
          return;
        }
        const keys = Object.keys(snapshot).filter(
          (k) => !['dirty', 'base_version', 'server_updated_at'].includes(k),
        );
        changes.push(
          this.version(table, String(snapshot.id), version),
          {
            sql: `UPDATE ${table} SET dirty=0 WHERE dirty=1 AND ${keys.map((k) => k + ' IS ?').join(' AND ')}`,
            params: keys.map((k) => snapshot[k]),
          },
          { ...stmt, sql: stmt.sql + ` WHERE ${table}.dirty=0` },
        );
      });
      await this.db.batch(changes);
      if (rows.length < 200) return;
    }
  }

  private async reconcile(table: SyncTable) {
    let after: string | null = null;
    for (;;) {
      const page = z
        .array(remoteId)
        .max(PAGE)
        .parse(await this.transport.manifest!(table, this.shop, after, PAGE));
      if (!page.length) break;
      const ids = page.map((r) => r.id);
      if (ids.some((id, i) => id <= (i ? ids[i - 1]! : (after ?? ''))))
        throw new Error('Unordered cloud manifest');
      const local = await this.db.query<{ row_id: string; version: number }>(
        `SELECT v.row_id,v.version FROM sync_versions v JOIN ${table} t
        ON t.id=v.row_id AND t.shop_id=v.shop_id WHERE v.shop_id=? AND v.table_name=? AND v.row_id IN (${ids.map(() => '?').join(',')})`,
        [this.shop, table, ...ids],
      );
      const versions = new Map(local.map((r) => [r.row_id, r.version]));
      const missing = page
        .filter((r) => (versions.get(r.id) ?? 0) < r.row_version)
        .map((r) => r.id);
      if (missing.length) {
        const rows = z
          .array(object)
          .length(missing.length)
          .parse(await this.transport.fetchRows!(table, this.shop, missing));
        const expected = new Set(missing);
        for (const row of rows) {
          if (!expected.delete(String(row.id))) throw new Error('Unexpected reconciliation row');
          await this.apply(table, row);
        }
      }
      after = ids.at(-1)!;
      if (page.length < PAGE) break;
    }
  }

  private async pull(table: SyncTable) {
    const tsKey = 'sync_cursor_' + table + '_timestamp',
      idKey = 'sync_cursor_' + table + '_id';
    const settings = await this.db.query<{ key: string; value: string }>(
      'SELECT key,value FROM settings WHERE key IN (?,?)',
      [tsKey, idKey],
    );
    const values = new Map(settings.map((r) => [r.key, r.value]));
    let ts = values.get(tsKey) ?? null,
      id = values.get(idKey) ?? null;
    const savedTs = ts,
      savedId = id;
    if (ts && id) {
      ts = new Date(Date.parse(ts) - 600000).toISOString();
      id = '00000000-0000-0000-0000-000000000000';
    } else {
      ts = null;
      id = null;
    }
    for (;;) {
      const page = z
        .array(object)
        .max(PAGE)
        .parse(await this.transport.pull(table, this.shop, ts, id, PAGE));
      for (const row of page) {
        const position = cursor.safeParse(row);
        if (!position.success) {
          await this.db.batch([
            this.attention(table, row, 'quarantine', 'Missing valid server cursor.'),
          ]);
          throw new Error('Cannot advance past a row without a valid server cursor.');
        }
        ts = position.data.server_updated_at;
        id = position.data.id;
        // Server timestamps retain microseconds. Compare the canonical UTC fractions before using the ID tie-breaker.
        const newer =
          !savedTs ||
          !savedId ||
          positionKey(ts) > positionKey(savedTs) ||
          (positionKey(ts) === positionKey(savedTs) && id > savedId);
        await this.apply(table, row, newer ? [setting(tsKey, ts), setting(idKey, id)] : []);
      }
      if (page.length < PAGE) return;
    }
  }

  async run() {
    const now = this.now().getTime();
    const full = now < this.lastManifest || now - this.lastManifest >= 86400000;
    if (full) await this.retry();
    for (const table of SYNC_TABLES) {
      await this.push(table);
      await this.pull(table);
      if (full) await this.reconcile(table);
    }
    if (full) this.lastManifest = now;
  }
  async retry() {
    for (const issue of await this.problems()) {
      if (issue.kind === 'quarantine')
        await this.apply(z.enum(SYNC_TABLES).parse(issue.table), object.parse(issue.row));
    }
  }
  async localCopy(table: SyncTable, id: string) {
    const [row] = await this.db.query<Row>(
      `SELECT * FROM ${z.enum(SYNC_TABLES).parse(table)} WHERE shop_id=? AND id=?`,
      [this.shop, id],
    );
    return row ?? null;
  }
  async resolve(table: SyncTable, id: string, observed: number, mine: boolean) {
    const rows = await this.db.query<{ payload: string }>(
      `SELECT payload FROM sync_attention WHERE ${keyColumns} AND kind='conflict' AND version=?`,
      [this.shop, table, id, observed],
    );
    if (!rows[0]) throw new Error('Conflict changed. Review it again.');
    const row = object.parse(JSON.parse(rows[0].payload));
    const { stmt, version } = this.decoded(table, row);
    await this.db.batch([
      {
        sql: `INSERT INTO _operation_guards VALUES('resolve-cloud-conflict', EXISTS(SELECT 1 FROM sync_attention WHERE ${keyColumns} AND kind='conflict' AND version=?))`,
        params: [this.shop, table, id, version],
      },
      { sql: "DELETE FROM _operation_guards WHERE id='resolve-cloud-conflict'" },
      ...(mine ? [] : [stmt]),
      this.version(table, id, version),
      {
        sql: `DELETE FROM sync_attention WHERE ${keyColumns} AND kind='conflict' AND version=?`,
        params: [this.shop, table, id, version],
      },
    ]);
  }
}
