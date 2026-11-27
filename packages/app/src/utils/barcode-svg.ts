/** Scannable EAN-13 barcode rendering as SVG, from the core module encoder. */
import { ean13BarRuns } from '@bali-hub-pos/core';

export interface BarcodeSvgOptions {
  /** Height of the bar area in user units (default 40). */
  height?: number;
  /** Width of one EAN-13 module in user units (default 2). */
  moduleWidth?: number;
  /** Quiet zone modules on each side (EAN spec minimum is 7; default 7). */
  quietZone?: number;
  /** Render the human-readable digits below the bars (default true). */
  showText?: boolean;
}

/**
 * Renders a valid EAN-13 barcode as an SVG string. Bars use crisp rectangles
 * on integer module boundaries so scanners get clean edges.
 */
export function barcodeSvgString(barcode: string, options: BarcodeSvgOptions = {}): string {
  const height = options.height ?? 40;
  const moduleWidth = options.moduleWidth ?? 2;
  const quietZone = options.quietZone ?? 7;
  const showText = options.showText ?? true;

  const runs = ean13BarRuns(barcode);
  const barWidth = 95 * moduleWidth;
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
    ? `<text x="${totalWidth / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="11">${barcode}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="Barcode ${barcode}"><g fill="#000" shape-rendering="crispEdges">${bars}</g>${text}</svg>`;
}
