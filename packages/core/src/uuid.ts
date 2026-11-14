/**
 * UUID v7 generation utility for VaporFlow.
 * UUID v7 features a time-ordered prefix (UNIX timestamp in milliseconds).
 */
import { randomBytes } from 'node:crypto';

export function uuidv7(): string {
  const now = Date.now();
  const timestampHex = now.toString(16).padStart(12, '0'); // 48-bit timestamp

  const rand = randomBytes(10);

  const timeHiAndVer = (((now / 0x10000) & 0x0fff) | 0x7000).toString(16).padStart(4, '0');
  const clockSeqHi = ((rand[0]! & 0x3f) | 0x80).toString(16).padStart(2, '0');
  const clockSeqLow = rand[1]!.toString(16).padStart(2, '0');
  const node = rand.subarray(2, 8).toString('hex');

  return [
    timestampHex.substring(0, 8),
    timestampHex.substring(8, 12),
    timeHiAndVer,
    clockSeqHi + clockSeqLow,
    node,
  ].join('-');
}
