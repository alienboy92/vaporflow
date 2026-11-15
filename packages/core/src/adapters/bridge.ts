import type {
  DbAdapter,
  FileAdapter,
  NetworkAdapter,
  PrinterAdapter,
  ScannerAdapter,
  ShareAdapter,
} from './types.js';
import type { DbCheckResult } from '../dev-check.js';

export interface DiagnosticsAdapter {
  read(): Promise<DbCheckResult>;
  createFixture(): Promise<DbCheckResult>;
  runContract?(): Promise<string[]>;
}
export interface DesktopBridge {
  platform: 'desktop';
  db: DbAdapter;
  diagnostics?: DiagnosticsAdapter;
}
export interface PlatformAdapters {
  platform: 'desktop' | 'android';
  db: DbAdapter;
  network: NetworkAdapter;
  printer: PrinterAdapter;
  share: ShareAdapter;
  file: FileAdapter;
  scanner: ScannerAdapter;
  diagnostics?: DiagnosticsAdapter;
}
