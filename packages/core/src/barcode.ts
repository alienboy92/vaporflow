/** EAN-13 barcode generation and validation utilities */

// EAN-13 digit encodings (7 modules each). L = left odd, G = left even, R = right.
const EAN13_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN13_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN13_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// Parity pattern for the first digit (L/G per remaining left digit).
const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function generateEAN13(): string {
  const prefix = '20';
  const middle = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
  const body = prefix + middle; // 12 digits
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const char = body.charAt(i);
    const digit = parseInt(char, 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return body + checkDigit;
}

export function validateBarcode(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const char = barcode.charAt(i);
    const digit = parseInt(char, 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  const lastChar = barcode.charAt(12);
  return expectedCheck === parseInt(lastChar, 10);
}

/**
 * Encode a valid EAN-13 barcode into its 95 modules (1 = bar, 0 = space):
 * start guard (3) + 6 left digits (42) + center guard (5) + 6 right digits (42) + end guard (3).
 */
export function encodeEAN13Modules(barcode: string): number[] {
  if (!validateBarcode(barcode)) {
    throw new Error(`Invalid EAN-13 barcode: ${barcode}`);
  }
  const digits = barcode.split('').map((d) => parseInt(d, 10));
  const parity = EAN13_PARITY[digits[0]!]!;
  const modules: number[] = [];

  const push = (pattern: string) => {
    for (const char of pattern) modules.push(char === '1' ? 1 : 0);
  };

  push('101'); // start guard
  for (let i = 1; i <= 6; i++) {
    const digit = digits[i]!;
    push(parity[i - 1] === 'L' ? EAN13_L[digit]! : EAN13_G[digit]!);
  }
  push('01010'); // center guard
  for (let i = 7; i <= 12; i++) {
    push(EAN13_R[digits[i]!]!);
  }
  push('101'); // end guard
  return modules;
}

/** Collapse module bits into black bar runs (offset/width in modules) for rendering. */
function modulesToBarRuns(modules: number[]): { offset: number; width: number }[] {
  const runs: { offset: number; width: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] === 1 && start === null) {
      start = i;
    } else if (modules[i] === 0 && start !== null) {
      runs.push({ offset: start, width: i - start });
      start = null;
    }
  }
  if (start !== null) runs.push({ offset: start, width: modules.length - start });
  return runs;
}

/** Collapse the 95 EAN-13 modules into black bar runs for rendering. */
export function ean13BarRuns(barcode: string): { offset: number; width: number }[] {
  return modulesToBarRuns(encodeEAN13Modules(barcode));
}

// ---------------------------------------------------------------------------
// Code 128 (Code Set B): letters, digits and mixed ASCII text.
// ---------------------------------------------------------------------------

/**
 * Code 128 symbol widths, alternating bar/space and starting with a bar.
 * Index is the symbol value; 104 = Start B, 106 = Stop (13 modules).
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;
/** Practical cap so a custom value still prints at a readable width on a label. */
export const CODE128_MAX_LENGTH = 40;

/**
 * Code 128 Set B accepts printable ASCII (space through tilde), so letters,
 * digits and mixed text all work. Non-ASCII text cannot be encoded.
 */
export function validateCode128(value: string): boolean {
  if (value.length === 0 || value.length > CODE128_MAX_LENGTH) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/** Encode a Code 128 Set B value into its modules (1 = bar, 0 = space). */
export function encodeCode128Modules(value: string): number[] {
  if (!validateCode128(value)) {
    throw new Error(`Invalid Code 128 barcode: ${value}`);
  }

  const symbols: number[] = [CODE128_START_B];
  let checksum = CODE128_START_B;
  for (let i = 0; i < value.length; i++) {
    const symbol = value.charCodeAt(i) - 32;
    symbols.push(symbol);
    checksum += symbol * (i + 1);
  }
  symbols.push(checksum % 103);
  symbols.push(CODE128_STOP);

  const modules: number[] = [];
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol]!;
    let isBar = true;
    for (const widthChar of pattern) {
      const width = Number(widthChar);
      for (let i = 0; i < width; i++) modules.push(isBar ? 1 : 0);
      isBar = !isBar;
    }
  }
  return modules;
}

/** Collapse Code 128 modules into black bar runs for rendering. */
export function code128BarRuns(value: string): { offset: number; width: number }[] {
  return modulesToBarRuns(encodeCode128Modules(value));
}

export type BarcodeSymbology = 'ean13' | 'code128';

/**
 * Pick the symbology used to render a stored barcode. Valid 13-digit EAN-13
 * values keep the existing EAN-13 rendering; everything else printable falls
 * back to Code 128.
 */
export function barcodeSymbology(value: string): BarcodeSymbology | null {
  if (validateBarcode(value)) return 'ean13';
  if (validateCode128(value)) return 'code128';
  return null;
}

/** True when the barcode can be drawn on a label by the built-in encoders. */
export function isRenderableBarcode(value: string): boolean {
  return barcodeSymbology(value) !== null;
}
