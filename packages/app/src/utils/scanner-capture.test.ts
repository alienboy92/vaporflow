import { expect, it } from 'vitest';
import { framedScanner } from './scanner-capture';

it('consumes framed scans including Enter and leaves ordinary typing alone', () => {
  const scans: string[] = [];
  const key = framedScanner(value => scans.push(value));
  expect(key('0')).toBe(false);
  expect(key('Enter')).toBe(false);
  const code = '0000123Ab' + 'x'.repeat(2000);
  for (let i = 0; i < 3; i++) {
    for (const k of ['F13', ...code, 'Enter']) expect(key(k)).toBe(true);
  }
  for (const k of ['F13', 'x', 'Tab', 'Enter', 'F13', 'x', 'Escape']) expect(key(k)).toBe(true);
  expect(scans).toEqual([code, code, code]);
});
