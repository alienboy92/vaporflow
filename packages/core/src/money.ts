/**
 * Money math utilities for VaporFlow.
 * Money is stored as integers (e.g. whole rupees for PKR, currency_decimals = 0).
 * Never floats. Quantities are integers.
 */

export interface MoneyLine {
  net_total?: number;
  list_price?: number;
  unit_price?: number;
  qty?: number;
  [key: string]: unknown;
}

export function formatMoney(amount: number, decimals = 0, currencyCode = 'PKR'): string {
  const formatted = decimals === 0 ? amount.toLocaleString() : (amount / Math.pow(10, decimals)).toFixed(decimals);
  return `${currencyCode} ${formatted}`;
}

export function parseMoney(input: string | number, decimals = 0): number {
  if (typeof input === 'number') {
    return Math.round(input * Math.pow(10, decimals));
  }
  const clean = input.replace(/[^0-9.-]+/g, '');
  const parsed = parseFloat(clean);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * Math.pow(10, decimals));
}

/**
 * Allocate discount across lines in proportion to line gross (unit_price * qty),
 * with the rounding remainder on the last non-zero gross line (or last line).
 * SPEC §8.4: Proportional allocation with remainder on the last line.
 */
export function allocateDiscount(
  items: { unit_price: number; qty: number }[],
  totalDiscountAmount: number
): number[] {
  if (items.length === 0) return [];
  const grossAmounts = items.map((item) => Math.max(0, item.unit_price * item.qty));
  const totalGross = grossAmounts.reduce((sum, g) => sum + g, 0);
  if (totalGross === 0) return new Array(items.length).fill(0);

  const effectiveDiscount = Math.min(totalDiscountAmount, totalGross);

  const discounts = new Array(items.length).fill(0);
  let remainingDiscount = effectiveDiscount;

  const nonZeroIndices = grossAmounts
    .map((g, i) => (g > 0 ? i : -1))
    .filter((i) => i !== -1);

  for (const i of nonZeroIndices) {
    const gross = grossAmounts[i]!;
    const proportion = gross / totalGross;
    const disc = Math.min(gross, Math.round(proportion * effectiveDiscount));
    discounts[i] = disc;
    remainingDiscount -= disc;
  }

  let idx = nonZeroIndices.length - 1;
  while (remainingDiscount > 0 && nonZeroIndices.length > 0) {
    const targetIdx = nonZeroIndices[idx % nonZeroIndices.length]!;
    const gross = grossAmounts[targetIdx]!;
    if (discounts[targetIdx]! < gross) {
      discounts[targetIdx]!++;
      remainingDiscount--;
    }
    idx--;
    if (nonZeroIndices.every((i) => discounts[i] === grossAmounts[i])) break;
  }

  const lastIdx = nonZeroIndices[nonZeroIndices.length - 1] ?? (items.length - 1);
  discounts[lastIdx] = Math.min(grossAmounts[lastIdx]!, Math.max(0, discounts[lastIdx]! + remainingDiscount));

  return items.map((item, i) => Math.max(0, (item.unit_price * item.qty) - discounts[i]!));
}

export function calcRefundAmount(netTotal: number, qtyReturned: number, qtySold: number): number {
  if (qtySold <= 0 || qtyReturned <= 0) return 0;
  if (qtyReturned >= qtySold) return netTotal;
  return Math.round((netTotal * qtyReturned) / qtySold);
}
