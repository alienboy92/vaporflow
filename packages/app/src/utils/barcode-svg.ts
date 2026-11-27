/** Scannable barcode rendering as SVG, from the core module encoders. */
import { barcodeSymbology, code128BarRuns, ean13BarRuns } from '@bali-hub-pos/core';

export interface BarcodeSvgOptions {
  /** Height of the bar area in user units (default 40). */
  height?: number;
  /** Width of one barcode module in user units (default 2). */
  moduleWidth?: number;
  /** Quiet zone modules on each side (default 7 for EAN-13, 10 for Code 128). */
  quietZone?: number;
  /** Render the human-readable value below the bars (default true). */
  showText?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Renders a barcode as an SVG string. Valid EAN-13 values use the EAN-13
 * encoder; any other printable ASCII value (letters, digits or mixed text) is
 * rendered as Code 128. Bars use crisp rectangles on integer module boundaries
 * so scanners get clean edges.
 */
export function barcodeSvgString(barcode: string, options: BarcodeSvgOptions = {}): string {
  const symbology = barcodeSymbology(barcode);
  if (!symbology) {
    throw new Error(`Cannot render barcode: ${barcode}`);
  }

  const height = options.height ?? 40;
  const moduleWidth = options.moduleWidth ?? 2;
  const quietZone = options.quietZone ?? (symbology === 'ean13' ? 7 : 10);
  const showText = options.showText ?? true;

  const runs = symbology === 'ean13' ? ean13BarRuns(barcode) : code128BarRuns(barcode);
  const moduleCount = symbology === 'ean13' ? 95 : 11 * barcode.length + 35;
  const barWidth = moduleCount * moduleWidth;
  const totalWidth = barWidth + quietZone * 2 * moduleWidth;
  const textArea = showText ? 14 : 0;
  const totalHeight = height + textArea;

  const bars = runs
    .map(
      (run) =>
        `<rect x="${quietZone * moduleWidth + run.offset * moduleWidth}" y="0" width="${
          run.width * moduleWidth
        }" height="${height}" />`,
    )
    .join('');

  const text = showText
    ? `<text x="${totalWidth / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="11">${escapeXml(barcode)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="Barcode ${escapeXml(barcode)}"><g fill="#000" shape-rendering="crispEdges">${bars}</g>${text}</svg>`;
}
