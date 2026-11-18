import { beforeEach, expect, it, vi } from 'vitest';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { capacitorScanner } from './scanner';

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    checkPermissions: vi.fn(),
    isGoogleBarcodeScannerModuleAvailable: vi.fn(),
    installGoogleBarcodeScannerModule: vi.fn(),
    scan: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(BarcodeScanner.checkPermissions).mockResolvedValue({ camera: 'granted' });
  vi.mocked(BarcodeScanner.isGoogleBarcodeScannerModuleAvailable).mockResolvedValue({ available: true });
});

it('requests the missing scanner module and prompts the cashier to retry', async () => {
  vi.mocked(BarcodeScanner.isGoogleBarcodeScannerModuleAvailable).mockResolvedValue({ available: false });
  await expect(capacitorScanner.scanWithCamera()).rejects.toThrow('download requested');
  expect(BarcodeScanner.installGoogleBarcodeScannerModule).toHaveBeenCalledOnce();
  expect(BarcodeScanner.scan).not.toHaveBeenCalled();
});

it('returns quietly on cancellation and surfaces other scan failures', async () => {
  vi.mocked(BarcodeScanner.scan)
    .mockRejectedValueOnce(new Error('scan canceled.'))
    .mockRejectedValueOnce(new Error('Camera unavailable'));
  await expect(capacitorScanner.scanWithCamera()).resolves.toBeNull();
  await expect(capacitorScanner.scanWithCamera()).rejects.toThrow('Camera unavailable');
});
