import { describe, it, expect, vi, beforeEach } from 'vitest';
import { capacitorShare, bytesToBase64 } from './share.js';

const writeFile = vi.fn(async () => undefined);
const getUri = vi.fn(async () => ({ uri: 'file:///cache/receipt-1.pdf' }));
const share = vi.fn(async () => undefined);

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: (...args: unknown[]) => writeFile(...(args as [])),
    getUri: (...args: unknown[]) => getUri(...(args as [])),
  },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'UTF8' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: (...args: unknown[]) => share(...(args as [])) },
}));

beforeEach(() => {
  writeFile.mockClear();
  getUri.mockClear();
  share.mockClear();
});

describe('capacitor share adapter (plugin doubles)', () => {
  it('writes binary files to cache as base64 and shares the returned URI', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    await capacitorShare.shareFile('receipt-1.pdf', bytes, 'application/pdf');

    expect(writeFile).toHaveBeenCalledWith({
      path: 'receipt-1.pdf',
      data: bytesToBase64(bytes),
      directory: 'CACHE',
    });
    expect(getUri).toHaveBeenCalledWith({ path: 'receipt-1.pdf', directory: 'CACHE' });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'receipt-1.pdf', url: 'file:///cache/receipt-1.pdf' }),
    );
  });

  it('writes text files with UTF-8 encoding instead of base64', async () => {
    await capacitorShare.shareFile('receipt-1.txt', 'hello', 'text/plain');

    expect(writeFile).toHaveBeenCalledWith({
      path: 'receipt-1.txt',
      data: 'hello',
      directory: 'CACHE',
      encoding: 'UTF8',
    });
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('propagates write failures instead of opening the share sheet', async () => {
    writeFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      capacitorShare.shareFile('receipt-1.pdf', new Uint8Array([1]), 'application/pdf'),
    ).rejects.toThrow('disk full');
    expect(share).not.toHaveBeenCalled();
  });

  it('encodes arbitrary bytes to base64 without Node Buffer', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe(btoa('hello'));
    const many = new Uint8Array(0x8000 + 5).map((_, i) => i % 251);
    expect(bytesToBase64(many)).toBe(btoa(String.fromCharCode(...many)));
  });
});
