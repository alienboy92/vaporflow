/** Historical v1 fixtures exercise old snapshots without exposing timestamp replication in the shipping engine. */
import { SyncEngine } from '../sync/engine.js';
import { SYNC_TABLES, MUTABLE_TABLES, TableSchemas, type SyncProblem } from '../sync/types.js';
import { toWire, wireToLocal } from '../sync/convert.js';
import { getTableUpsertStatement } from '../sync/apply-row.js';
export class LegacySyncEngine extends SyncEngine {
  private problems: SyncProblem[] = [];
  protected override async runReplication() { await this.pushAll(); await this.pullAll(); }
  protected override async readProblems() { return this.problems; }
  getProblems(): SyncProblem[] {
    return [...this.problems];
  }

  clearProblem(table: string, id: string): void {
    this.problems = this.problems.filter((p) => !(p.table === table && p.id === id));
  }

  private async pushAll(): Promise<void> {
    for (const table of SYNC_TABLES) {
      await this.pushTable(table);
    }
  }

  private async pushTable(table: string): Promise<void> {
    let pushing = true;
    while (pushing) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE shop_id = ? AND dirty = 1 LIMIT 200`,
        [this.shopId],
      );
      if (rows.length === 0) {
        break;
      }

      const snapshots = new Map<string, string>();
      for (const row of rows) {
        snapshots.set(String(row.id), String(row.updated_at));
      }

      // Local -> wire: the transport speaks PostgreSQL JSON (booleans, no
      // dirty/server_updated_at). This is what sync_push receives in
      // production; testing only ever exercised SQLite-shaped rows before.
      const wireRows = rows.map((row) => toWire(table, row));

      let result: { accepted: number; errors?: Array<{ id: string; error: string }> };
      try {
        result = await this.transport.push(table, wireRows);
      } catch (err: unknown) {
        // Batch-atomic transports (the real sync_push RPC) reject the whole
        // batch and write nothing — there is no per-row error array. Surface
        // one actionable problem for the batch and let syncNow schedule the
        // backoff retry.
        const message = err instanceof Error ? err.message : String(err);
        const batchId = String(rows[0]!.id);
        this.problems = this.problems.filter((p) => !(p.table === table && p.id === batchId));
        this.problems.push({
          table,
          id: batchId,
          error: `Push rejected: ${message}`,
          timestamp: this.clock().toISOString(),
          row: wireRows,
        });
        throw err instanceof Error ? err : new Error(message);
      }

      const rejectedIds = new Set<string>();
      if (result.errors) {
        for (const err of result.errors) {
          rejectedIds.add(err.id);
          const rejectedRow = rows.find((r) => String(r.id) === err.id);
          this.problems = this.problems.filter(
            (p) => !(p.table === table && p.id === err.id),
          );
          this.problems.push({
            table,
            id: err.id,
            error: err.error,
            timestamp: this.clock().toISOString(),
            row: rejectedRow,
          });
        }
      }

      // Conditional dirty-clear in ONE batch: each statement re-checks
      // `dirty = 1 AND updated_at = snapshot` inside the SQL, so an edit that
      // lands while the push is in flight (new updated_at, dirty = 1) is
      // never wrongly cleared — the check and the write are the same atomic
      // operation, not a check-then-act across an await.
      const nowIso = this.clock().toISOString();
      const statements: { sql: string; params?: unknown[] }[] = [];
      for (const row of rows) {
        const id = String(row.id);
        if (rejectedIds.has(id)) {
          continue;
        }
        statements.push({
          sql: `UPDATE ${table} SET dirty = 0, server_updated_at = ? WHERE id = ? AND dirty = 1 AND updated_at = ?`,
          params: [nowIso, id, snapshots.get(id)],
        });
      }

      if (statements.length > 0) {
        await this.db.batch(statements);
        // A successful acknowledgement also clears any earlier problem
        // recorded for these rows (e.g. a conflict fixed since).
        for (const row of rows) {
          const id = String(row.id);
          if (!rejectedIds.has(id)) {
            this.problems = this.problems.filter((p) => !(p.table === table && p.id === id));
          }
        }
      }

      if (rows.length < 200) {
        pushing = false;
      }
    }
  }

  private async pullAll(): Promise<void> {
    for (const table of SYNC_TABLES) {
      await this.pullTable(table);
    }
  }

  private async pullTable(table: string): Promise<void> {
    const schema = TableSchemas[table as keyof typeof TableSchemas];
    const mutable = MUTABLE_TABLES.has(table);

    const tsKey = `sync_cursor_${table}_timestamp`;
    const idKey = `sync_cursor_${table}_id`;

    const settingsRows = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN (?, ?)`,
      [tsKey, idKey],
    );
    const settingsMap = new Map<string, string>();
    for (const r of settingsRows) {
      if (r.value !== null) {
        settingsMap.set(r.key, r.value);
      }
    }

    let cursorTs: string | null = settingsMap.get(tsKey) ?? null;
    let cursorId: string | null = settingsMap.get(idKey) ?? null;

    if (cursorTs !== null) {
      const parsedDate = new Date(cursorTs);
      if (!isNaN(parsedDate.getTime())) {
        parsedDate.setTime(parsedDate.getTime() - 5000);
        cursorTs = parsedDate.toISOString();
      }
    }

    let pulling = true;
    while (pulling) {
      const pulled = await this.transport.pull(
        table,
        this.shopId,
        cursorTs,
        cursorId,
        500,
      );
      const incomingRows = pulled as Array<Record<string, unknown>>;
      if (incomingRows.length === 0) {
        break;
      }

      const statements: { sql: string; params?: unknown[] }[] = [];
      let lastServerUpdatedAt = cursorTs;
      let lastId = cursorId;

      for (const raw of incomingRows) {
        const rawRow = raw as Record<string, unknown>;
        const rowId =
          typeof rawRow.id === 'string' && rawRow.id ? rawRow.id : String(rawRow.id ?? 'unknown');
        // The cursor for this row, usable even when the row fails validation.
        const rowCursorTs = typeof rawRow.server_updated_at === 'string'
          ? rawRow.server_updated_at : null;

        let validated: Record<string, unknown>;
        try {
          // Wire -> local first: PG booleans become 0/1, timestamps become
          // 3ms UTC, and the missing `dirty` column is injected before the
          // local schema validates the row.
          validated = schema.parse(wireToLocal(table, rawRow)) as Record<string, unknown>;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.problems.push({
            table,
            id: rowId,
            error: `Validation error: ${message}`,
            timestamp: this.clock().toISOString(),
            row: rawRow,
          });
          // Rejected rows must still advance the cursor: they are kept in
          // problems, so nothing disappears, but the pull must not wedge
          // forever re-fetching the same page. Only rows with an unusable
          // server identity cannot advance (and cannot block a later valid
          // row in the same page from advancing past them).
          if (rowCursorTs !== null && rowId !== 'unknown') {
            lastServerUpdatedAt = rowCursorTs;
            lastId = rowId;
          }
          continue;
        }

        const id = String(validated.id);
        const serverUpdatedAt = String(validated.server_updated_at);

        const stmt = getTableUpsertStatement(table, validated, serverUpdatedAt);
        if (mutable) {
          stmt.sql += ` WHERE ${table}.dirty = 0 OR ${table}.updated_at <= excluded.updated_at`;
        }
        statements.push(stmt);

        lastServerUpdatedAt = rowCursorTs;
        lastId = id;
      }

      if (lastServerUpdatedAt && lastId) {
        statements.push({
          sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
          params: [tsKey, lastServerUpdatedAt, lastServerUpdatedAt],
        });
        statements.push({
          sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
          params: [idKey, lastId, lastId],
        });
      }

      if (statements.length > 0) {
        try {
          await this.db.batch(statements);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const conflictingId = lastId ?? String(incomingRows[incomingRows.length - 1]?.id ?? 'unknown');
          this.problems.push({
            table,
            id: conflictingId,
            error: `Pull apply failed: ${message}`,
            timestamp: this.clock().toISOString(),
            row: incomingRows.find((r) => String(r.id) === conflictingId),
          });
          break;
        }
      }

      cursorTs = lastServerUpdatedAt;
      cursorId = lastId;

      if (incomingRows.length < 500) {
        pulling = false;
      }
    }
  }
}
