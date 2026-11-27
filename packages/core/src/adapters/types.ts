/** Platform adapter interfaces for Bali Hub POS (SPEC 5) */

export interface DbAdapter {
  backupForCloudChange?(): Promise<string>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  migrate(): Promise<void>;
}

export interface NetworkAdapter {
  isOnline(): boolean;
  onChange(callback: (online: boolean) => void): () => void;
}

export interface PrinterAdapter {
  printReceipt(html: string): Promise<void>;
  printLabels(html: string): Promise<void>;
}

export interface ShareAdapter {
  shareFile(name: string, data: Uint8Array | string, mime: string): Promise<void>;
}

export interface FileAdapter {
  exportBackup(): Promise<void>;
  importBackup(): Promise<string>;
}

export interface ScannerAdapter {
  scanWithCamera(): Promise<string | null>;
}
