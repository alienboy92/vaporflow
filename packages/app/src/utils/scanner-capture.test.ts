import { expect, it, vi } from 'vitest';
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

it('strips configured characters once and completes a framed suffix without Enter', () => {
  const received: string[] = [];
  const key = framedScanner(code => received.push(code), () => ({ prefix: 'P:', suffix: '!' }));
  for (const k of ['F13', ...'P:0001!']) key(k);
  expect(received).toEqual(['0001']);
});

it('finishes a framed scan on inactivity without a suffix or Enter', () => {
  vi.useFakeTimers();
  try {
    const received: string[] = [];
    const key = framedScanner(code => received.push(code), () => ({prefix: 'P', suffix: ''}));
    for (const k of ['F13', ...'P001']) key(k);
    vi.advanceTimersByTime(250);
    expect(received).toEqual(['001']);
    expect(key('x')).toBe(false);
  } finally { vi.useRealTimers(); }
});
