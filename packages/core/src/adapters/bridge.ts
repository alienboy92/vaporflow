import type { DbAdapter, NetworkAdapter, PrinterAdapter, ScannerAdapter, ShareAdapter } from './types.js';

/** Minimal app-level controls shared by desktop and Android. */
export interface AppAdapter {
  getSetupSql?(): Promise<string | null>;
  downloadAndroidUpdate?(url: string, sha256: string): Promise<void>;
  downloadUpdate?(): Promise<void>;
  restartToUpdate?(): Promise<void>;
  openBackupFolder?(): Promise<void>;
  /** Opens an allow-listed HTTPS link in the system browser. */
  openExternal(url: string): Promise<void>;
}

/** The setup SQL resource is available only in the Windows desktop app. */
export async function getSetupSql(app: AppAdapter): Promise<string | null> {
  return app.getSetupSql ? app.getSetupSql() : null;
}

export interface DesktopBridge {
  platform: 'desktop';
  db: DbAdapter;
  app: AppAdapter;
}
export interface PlatformAdapters {
  platform: 'desktop' | 'android';
  db: DbAdapter;
  network: NetworkAdapter;
  share: ShareAdapter;
  scanner: ScannerAdapter;
  printer: PrinterAdapter;
  app: AppAdapter;
}
