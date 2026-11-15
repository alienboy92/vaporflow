/** EAN-13 barcode generation and validation utilities */

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
