import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  BatchSchema,
  StatementSchema,
  RowsSchema,
  DbCheckResultSchema,
  type DesktopBridge,
  type PlatformAdapters,
} from '@vaporflow/core';

declare global {
  interface Window {
    vaporflow?: DesktopBridge;
  }
}
const PlatformContext = createContext<PlatformAdapters | null>(null);
let startup: Promise<PlatformAdapters> | undefined;
const unsupported = (feature: string): Promise<never> =>
  Promise.reject(new Error(`${feature} is not implemented in Phase 2`));

async function initialize(): Promise<PlatformAdapters> {
  let database: Pick<PlatformAdapters, 'db' | 'diagnostics' | 'platform'>;
  if (window.vaporflow?.platform === 'desktop') {
    const api = window.vaporflow;
    database = {
      platform: 'desktop',
      db: {
        async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
          const input = StatementSchema.parse({ sql, params });
          return RowsSchema.parse(await api.db.query(input.sql, input.params)) as T[];
        },
        batch: (statements) => api.db.batch(BatchSchema.parse(statements)),
        migrate: () => api.db.migrate(),
      },
      diagnostics: api.diagnostics
        ? {
            read: async () => DbCheckResultSchema.parse(await api.diagnostics!.read()),
            createFixture: async () =>
              DbCheckResultSchema.parse(await api.diagnostics!.createFixture()),
          }
        : undefined,
    };
    await database.db.migrate();
  } else {
    const { createMobileDatabase } = await import('@vaporflow/mobile');
    database = {
      platform: 'android',
      ...(await createMobileDatabase(
        import.meta.env.DEV || import.meta.env.MODE === 'diagnostics',
      )),
    };
  }
  return {
    ...database,
    network: {
      isOnline: () => navigator.onLine,
      onChange(callback) {
        const changed = () => callback(navigator.onLine);
        window.addEventListener('online', changed);
        window.addEventListener('offline', changed);
        return () => {
          window.removeEventListener('online', changed);
          window.removeEventListener('offline', changed);
        };
      },
    },
    printer: {
      printReceipt: () => unsupported('Receipt printing'),
      printLabels: () => unsupported('Label printing'),
    },
    share: { shareFile: () => unsupported('File sharing') },
    file: {
      exportBackup: () => unsupported('Backup export'),
      importBackup: () => unsupported('Backup import'),
    },
    scanner: { scanWithCamera: () => unsupported('Camera scanning') },
  };
}
export function DbProvider({ children }: { children: ReactNode }) {
  const [adapters, setAdapters] = useState<PlatformAdapters | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    startup ??= initialize().catch((error) => {
      startup = undefined;
      throw error;
    });
    startup.then(
      (value) => {
        if (active) setAdapters(value);
      },
      (error) => {
        if (active) setError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (error)
    return (
      <main className="p-6">
        <h1>VaporFlow — Database unavailable</h1>
        <p role="alert">{error}</p>
        <button
          className="mt-4 min-h-11 rounded bg-blue-700 px-4 text-white"
          onClick={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      </main>
    );
  if (!adapters)
    return (
      <main className="p-6" role="status">
        VaporFlow — Opening database…
      </main>
    );
  return <PlatformContext.Provider value={adapters}>{children}</PlatformContext.Provider>;
}
export function usePlatform(): PlatformAdapters {
  const adapters = useContext(PlatformContext);
  if (!adapters) throw new Error('Platform provider missing');
  return adapters;
}
export function useDb() {
  return usePlatform().db;
}
