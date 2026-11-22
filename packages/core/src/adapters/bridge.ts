import type { DbAdapter, NetworkAdapter, PrinterAdapter, ScannerAdapter, ShareAdapter } from './types.js';

/** Minimal app-level controls shared by desktop and Android. */
export interface AppAdapter {
  /** Opens an allow-listed HTTPS link in the system browser. */
  openExternal(url: string): Promise<void>;
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
