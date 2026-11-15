import { describe, it, expect } from 'vitest';
import { generateEAN13, validateBarcode, encodeEAN13Modules, ean13BarRuns } from './barcode.js';

describe('EAN-13 module encoding', () => {
  it('produces exactly 95 modules with correct guard patterns', () => {
    const barcode = generateEAN13();
    const modules = encodeEAN13Modules(barcode);
    expect(modules).toHaveLength(95);

    // Start guard 101 (modules 0-2), center guard 01010 (modules 45-49), end guard 101 (92-94).
    const asString = modules.join('');
    expect(asString.startsWith('101')).toBe(true);
    expect(asString.slice(45, 50)).toBe('01010');
    expect(asString.endsWith('101')).toBe(true);
  });

  it('encodes left digits per first-digit parity and right digits with R patterns', () => {
    // Known reference encoding for 4006381333931.
    const modules = encodeEAN13Modules('4006381333931').join('');
    // First digit 4 -> parity LGLLGG applied to left digits 0,0,6,3,8,1:
    // 0=L(0001101) 0=G(0100111) 6=L(0101111) 3=L(0111101) 8=G(0001001) 1=G(0110011)
    expect(modules.slice(3, 3 + 7 * 6)).toBe(
      '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011',
    );
    // Right digits 3,3,3,9,3,1 encoded with R patterns after the center guard:
    // 3=R(1000010) 3=R(1000010) 3=R(1000010) 9=R(1110100) 3=R(1000010) 1=R(1100110)
    expect(modules.slice(50, 50 + 7 * 6)).toBe(
      '1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110',
    );
  });

  it('rejects invalid barcodes', () => {
    expect(() => encodeEAN13Modules('1234567890128')).not.toThrow(); // valid checksum
    expect(() => encodeEAN13Modules('1234567890123')).toThrow(/Invalid EAN-13/); // wrong checksum
    expect(() => encodeEAN13Modules('not-a-barcode')).toThrow(/Invalid EAN-13/);
    expect(() => encodeEAN13Modules('123456789012')).toThrow(/Invalid EAN-13/); // too short
  });

  it('round-trips generated barcodes into well-formed bar runs', () => {
    for (let i = 0; i < 25; i++) {
      const barcode = generateEAN13();
      expect(validateBarcode(barcode)).toBe(true);

      const modules = encodeEAN13Modules(barcode);
      const runs = ean13BarRuns(barcode);

      // Rebuild modules from runs: black runs match, white gaps fill the rest.
      const rebuilt = new Array<number>(95).fill(0);
      for (const run of runs) {
        expect(run.offset).toBeGreaterThanOrEqual(0);
        expect(run.width).toBeGreaterThan(0);
        expect(run.offset + run.width).toBeLessThanOrEqual(95);
        for (let m = run.offset; m < run.offset + run.width; m++) rebuilt[m] = 1;
      }
      expect(rebuilt.join('')).toBe(modules.join(''));

      // Bars never touch: every run is followed by at least one quiet module
      // except possibly at the very end guards' boundary (guards are 101, so
      // runs are always separated by at least one zero module).
      for (let r = 1; r < runs.length; r++) {
        expect(runs[r]!.offset).toBeGreaterThan(runs[r - 1]!.offset + runs[r - 1]!.width - 1);
        expect(runs[r]!.offset).toBeGreaterThanOrEqual(runs[r - 1]!.offset + runs[r - 1]!.width);
      }
    }
  });

  it('encodes the same digits deterministically', () => {
    const barcode = generateEAN13();
    expect(encodeEAN13Modules(barcode).join('')).toBe(encodeEAN13Modules(barcode).join(''));
  });
});
