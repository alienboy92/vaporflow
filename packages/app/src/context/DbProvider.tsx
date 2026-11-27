import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  BatchSchema,
  StatementSchema,
  RowsSchema,
  type DesktopBridge,
  type PlatformAdapters,
} from '@bali-hub-pos/core';
import { browserPrinter } from '../utils/printer';

declare global {
  interface Window {
    vaporflow?: DesktopBridge;
  }
}
const PlatformContext = createContext<PlatformAdapters | null>(null);
let startup: Promise<PlatformAdapters> | undefined;
const unavailable = (feature: string): Promise<never> =>
  Promise.reject(new Error(`${feature} is not available on this device.`));

/** Desktop file share: save the payload through a blob download. */
async function shareFileDesktop(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes =
    data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function initialize(): Promise<PlatformAdapters> {
  let database: Pick<PlatformAdapters, 'db' | 'platform' | 'share' | 'scanner' | 'printer' | 'app'>;
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
        backupForCloudChange: () => api.db.backupForCloudChange!(),
        migrate: () => api.db.migrate(),
      },
      share: {
        shareFile: (name, data, mime) => shareFileDesktop(name, data, mime),
      },
      scanner: {
        scanWithCamera: () => unavailable('Camera scanning'),
      },
      printer: browserPrinter,
      app: {
        downloadUpdate: api.app.downloadUpdate,
        restartToUpdate: api.app.restartToUpdate,
        openBackupFolder: () => api.app.openBackupFolder!(),
        openExternal: (url) => api.app.openExternal(url),
      },
    };
    await database.db.migrate();
  } else {
    const { createMobileDatabase } = await import('@bali-hub-pos/mobile');
    database = {
      platform: 'android',
      ...(await createMobileDatabase()),
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
    share:
      database.share ?? {
        shareFile: () => unavailable('File sharing'),
      },
    scanner:
      database.scanner ?? {
        scanWithCamera: () => unavailable('Camera scanning'),
      },
    printer: database.printer ?? browserPrinter,
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
        <h1>Bali Hub POS — Database unavailable</h1>
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
        Bali Hub POS — Opening database…
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
