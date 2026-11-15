/** Platform-neutral asynchronous database contract. */
export interface DbAdapter {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  migrate(migrationsDir: string): Promise<void>;
}
