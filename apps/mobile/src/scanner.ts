import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import type { ScannerAdapter } from '@vaporflow/core';

export const capacitorScanner: ScannerAdapter = {
  async scanWithCamera(): Promise<string | null> {
    try {
      const status = await BarcodeScanner.checkPermissions();
      if (status.camera !== 'granted') {
        const request = await BarcodeScanner.requestPermissions();
        if (request.camera !== 'granted') {
          return null;
        }
      }
      const result = await BarcodeScanner.scan();
      const first = result.barcodes?.[0];
      return first?.rawValue ?? null;
    } catch {
      return null;
    }
  },
};
