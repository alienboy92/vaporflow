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

/** Collapse the 95 modules into black bar runs (offset/width in modules) for rendering. */
export function ean13BarRuns(barcode: string): { offset: number; width: number }[] {
  const modules = encodeEAN13Modules(barcode);
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
