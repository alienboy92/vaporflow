import type { DbAdapter, NetworkAdapter, PrinterAdapter, ScannerAdapter, ShareAdapter } from './types.js';

export interface DesktopBridge {
  platform: 'desktop';
  db: DbAdapter;
}
export interface PlatformAdapters {
  platform: 'desktop' | 'android';
  db: DbAdapter;
  network: NetworkAdapter;
  share: ShareAdapter;
  scanner: ScannerAdapter;
  printer: PrinterAdapter;
}
