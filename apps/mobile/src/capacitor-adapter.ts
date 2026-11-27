import { Directory, Filesystem } from '@capacitor/filesystem';
import { backupName } from '@bali-hub-pos/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import {
  applyMigrations,
  BatchSchema,
  StatementSchema,
  RowsSchema,
  returnsRows,
  MIGRATIONS,
  type MigrationRecord,
  type DbAdapter,
} from '@bali-hub-pos/core';

const connections = new SQLiteConnection(CapacitorSQLite);
export type MobileConnection = Pick<
  SQLiteDBConnection,
  'query' | 'run' | 'execute' | 'executeTransaction'
>;
export interface MobileConnectionHandle {
  db: MobileConnection;
  close(): Promise<void>;
}

async function openNative(name: string): Promise<MobileConnectionHandle> {
  const consistent = await connections.checkConnectionsConsistency();
  const exists = await connections.isConnection(name, false);
  const db =
    consistent.result && exists.result
      ? await connections.retrieveConnection(name, false)
      : await connections.createConnection(name, false, 'no-encryption', 1, false);
  await db.open();
  // PRAGMA foreign_keys cannot change inside an active transaction.
  await db.execute('PRAGMA foreign_keys = ON;', false);
  return { db, close: () => connections.closeConnection(name, false) };
}

export class CapacitorDbAdapter implements DbAdapter {
  private handle: Promise<MobileConnectionHandle> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly name = 'vaporflow',
    private readonly migrations: readonly MigrationRecord[] = MIGRATIONS,
    private readonly open: (name: string) => Promise<MobileConnectionHandle> = openNative,
  ) {}

  private connection(): Promise<MobileConnectionHandle> {
    this.handle ??= this.open(this.name).catch((error) => {
      this.handle = undefined;
      throw error;
    });
    return this.handle;
  }
  // A connection's queries must not leak into another operation's transaction.
  private serial<T>(work: (db: MobileConnection) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => work((await this.connection()).db));
    this.queue = result.catch(() => undefined);
    return result;
  }
  query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.serial(async (db) => {
      const input = StatementSchema.parse({ sql, params });
      if (returnsRows(input.sql)) {
        const result = await db.query(input.sql, input.params);
        return RowsSchema.parse(result.values ?? []) as T[];
      }
      await db.run(input.sql, input.params);
      return [];
    });
  }
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    return this.serial(async (db) => {
      const inputs = BatchSchema.parse(statements);
      if (!inputs.length) return;
      try {
        await db.executeTransaction(
          inputs.map((input) => ({ statement: input.sql, values: input.params })),
        );
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  }
  backupForCloudChange(): Promise<string> {
    return this.serial(async db => {
      try { await Filesystem.mkdir({directory:Directory.Data,path:'backups',recursive:true}); }
      catch { await Filesystem.readdir({directory:Directory.Data,path:'backups'}); }
      const name = backupName();
      const files = await Filesystem.readdir({directory:Directory.Data,path:'backups'});
      if(files.files.some(file => file.name === name)) throw Error('Retry the backup in a second.');
      const {uri} = await Filesystem.getUri({directory:Directory.Data,path:'backups/'+name});
      const file = decodeURIComponent(new URL(uri).pathname);
      await db.run('VACUUM INTO ?', [file], false);
      await db.run('ATTACH DATABASE ? AS verified_backup',[file],false);
      try {
        for(const table of ['products','sales']) {
          const result = await db.query(`SELECT (SELECT count(*) FROM main.${table})=(SELECT count(*) FROM verified_backup.${table}) AS ok`);
          if(RowsSchema.parse(result.values)[0]?.ok !== 1) throw Error('Backup verification failed.');
        }
      } finally { await db.run('DETACH DATABASE verified_backup',[],false); }
      return file;
    });
  }
  migrate(): Promise<void> {
    return this.serial(async (db) => {
      await applyMigrations(
        {
          query: async (sql) => (await db.query(sql)).values ?? [],
          beforeUpgrade: async () => {
            const databases = RowsSchema.parse((await db.query('PRAGMA database_list')).values);
            const file = databases.find((row) => row.name === 'main')?.file;
            if (typeof file !== 'string') throw new Error('Could not locate the database for backup.');
            if (file) await db.run('VACUUM INTO ?', [file + '.pre-upgrade-' + crypto.randomUUID() + '.sqlite'], false);
          },
          execute: async (sql) => {
            await db.execute(sql);
          },
          apply: async (migration) => {
            try {
              // No values on the script task: plugin executes the whole script, including triggers.
              await db.executeTransaction([
                { statement: migration.sql },
                {
                  statement: "INSERT INTO _migrations(name,applied_at) VALUES (?,datetime('now'))",
                  values: [migration.name],
                },
              ]);
            } catch (error) {
              throw error instanceof Error ? error : new Error(String(error));
            }
          },
        },
        this.migrations,
      );
    });
  }
  async close(): Promise<void> {
    await this.queue;
    if (this.handle) await (await this.handle).close();
    this.handle = undefined;
  }
}
