/** Exact integer money operations; BigInt intermediates avoid precision loss. */
export function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('Expected a safe integer');
  return value;
}
export function fromInteger(value: bigint): number {
  return safeInteger(Number(value));
}
export function addMoney(...values: number[]): number {
  return fromInteger(values.reduce((sum, value) => sum + BigInt(safeInteger(value)), 0n));
}
function scale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)
    throw new Error('Invalid currency precision');
  return 10n ** BigInt(decimals);
}
/** Integer equivalent of Math.round, including negative half-way values. */
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Invalid denominator');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder >= 0n) return quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return quotient - (-remainder * 2n > denominator ? 1n : 0n);
}
export function formatMoney(amount: number, decimals = 0, currencyCode = 'PKR'): string {
  const unit = scale(decimals);
  const value = BigInt(safeInteger(amount));
  const abs = value < 0n ? -value : value;
  const whole = (abs / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals ? '.' + (abs % unit).toString().padStart(decimals, '0') : '';
  return `${currencyCode} ${value < 0n ? '-' : ''}${whole}${fraction}`;
}
export function parseMoney(input: string | number, decimals = 0): number {
  const unit = scale(decimals);
  if (typeof input === 'number' && !Number.isFinite(input)) throw new Error('Invalid money');
  const text = String(input)
    .trim()
    .replace(/^[A-Z]{3}\s+/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error('Invalid money');
  const normalized = text.replaceAll(',', '');
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole!) * denominator + BigInt(fraction || '0')) * unit;
  return fromInteger(roundRatio(negative ? -numerator : numerator, denominator));
}
/** SPEC 8.4: all rounding remainder goes to the last line.
 * Owner explicitly approved negative final lines for rounding edge cases.
 */
export function allocateDiscount(
  items: { unit_price: number; qty: number }[],
  discount: number,
): number[] {
  safeInteger(discount);
  if (discount < 0) throw new Error('Discount must be non-negative');
  const grosses = items.map(({ unit_price, qty }) => {
    if (safeInteger(unit_price) < 0 || safeInteger(qty) <= 0) throw new Error('Invalid cart line');
    const gross = BigInt(unit_price) * BigInt(qty);
    fromInteger(gross);
    return gross;
  });
  const total = grosses.reduce((sum, gross) => sum + gross, 0n);
  fromInteger(total);
  if (BigInt(discount) > total) throw new Error('Discount exceeds subtotal');
  if (total === 0n) return grosses.map(() => 0);
  let allocated = 0n;
  return grosses.map((gross, index) => {
    const share =
      index === grosses.length - 1
        ? BigInt(discount) - allocated
        : roundRatio(gross * BigInt(discount), total);
    allocated += share;
    return fromInteger(gross - share);
  });
}
export function calcRefundAmount(netTotal: number, qtyReturned: number, qtySold: number): number {
  safeInteger(netTotal);
  if (safeInteger(qtySold) <= 0 || safeInteger(qtyReturned) <= 0 || qtyReturned > qtySold)
    throw new Error('Invalid return quantity');
  return fromInteger(roundRatio(BigInt(netTotal) * BigInt(qtyReturned), BigInt(qtySold)));
}
