import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import type { ScannerAdapter } from '@vaporflow/core';

export const capacitorScanner: ScannerAdapter = {
  async scanWithCamera(): Promise<string | null> {
    // Permission problems must surface as errors (the UI shows them); only a
    // cancelled scan or a scanner failure resolves as null.
    let status = await BarcodeScanner.checkPermissions();
    if (status.camera !== 'granted') {
      status = await BarcodeScanner.requestPermissions();
      if (status.camera !== 'granted') {
        throw new Error('Camera permission was denied. Enable the camera for VaporFlow in Android settings to scan barcodes.');
      }
    }
    try {
      const result = await BarcodeScanner.scan();
      const first = result.barcodes?.[0];
      return first?.rawValue ?? null;
    } catch {
      // User closed the scanner (or the scan failed) — treated as cancellation.
      return null;
    }
  },
};
