import { describe, it, expect } from 'vitest';
import { barcodeSvgString } from './barcode-svg';
import { generateEAN13 } from '@bali-hub-pos/core';

describe('barcode SVG', () => {
  it('renders bars only on black runs with quiet zones and human text', () => {
    const barcode = '4006381333931';
    const svg = barcodeSvgString(barcode, { moduleWidth: 2, height: 40 });

    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('viewBox="0 0 218 54"'); // 95*2 + 2*7*2 = 218 wide; 40 + 14 text = 54
    expect(svg).toContain(`aria-label="Barcode ${barcode}"`);
    expect(svg).toContain(`>${barcode}</text>`);

    // The first bar starts after the quiet zone and is the 1-module start guard.
    expect(svg).toContain('<rect x="14" y="0" width="2" height="40" />');
    // The last bar is the 1-module end guard ending at the right quiet zone.
    expect(svg).toContain('<rect x="202" y="0" width="2" height="40" />');
  });

  it('can omit the human-readable text', () => {
    const svg = barcodeSvgString(generateEAN13(), { showText: false, height: 30 });
    expect(svg).not.toContain('<text');
    expect(svg).toContain('viewBox="0 0 218 30"');
  });

  it('scales with moduleWidth', () => {
    const svg = barcodeSvgString('4006381333931', { moduleWidth: 3, height: 50, showText: false });
    expect(svg).toContain('viewBox="0 0 327 50"');
  });

  it('renders custom text barcodes as Code 128', () => {
    const svg = barcodeSvgString('POD-MINT-01', { moduleWidth: 2, height: 40 });

    // 11 modules per character + 11 start + 11 checksum + 13 stop = 11*n + 35.
    // 11*11 + 35 = 156 modules; 156*2 + 2*10*2 = 352 wide; 40 + 14 text = 54 tall.
    expect(svg).toContain('viewBox="0 0 352 54"');
    expect(svg).toContain('aria-label="Barcode POD-MINT-01"');
    expect(svg).toContain('>POD-MINT-01</text>');
    expect(svg).toContain('<rect x="20" y="0" width="4" height="40" />');
  });

  it('uses the EAN-13 encoder for valid 13-digit values', () => {
    const svg = barcodeSvgString('4006381333931', { moduleWidth: 2, height: 40 });
    // EAN-13 is still 95 modules with a 7-module quiet zone.
    expect(svg).toContain('viewBox="0 0 218 54"');
  });

  it('rejects values that no built-in encoder can render', () => {
    expect(() => barcodeSvgString('')).toThrow(/Cannot render barcode/);
    expect(() => barcodeSvgString('café')).toThrow(/Cannot render barcode/);
  });
});
