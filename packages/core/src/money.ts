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

/**
 * Format an integer money amount for display.
 * @param amount integer amount
 * @param decimals number of decimals (0 for PKR)
 * @param currencyCode currency symbol or code
 */
export function formatMoney(amount: number, decimals = 0, currencyCode = 'PKR'): string {
  const formatted = decimals === 0 ? amount.toLocaleString() : (amount / Math.pow(10, decimals)).toFixed(decimals);
  return `${currencyCode} ${formatted}`;
}

/**
 * Parse a string or number into integer money.
 */
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
 * with the rounding remainder assigned to the last line.
 *
 * SPEC §8.4: "Discount is entered at sale level as an amount or a percent.
 * It is allocated across lines in proportion to line gross, with the rounding
 * remainder on the last line, and stored per line as net_total."
 *
 * @param items array of items with unit_price and qty
 * @param totalDiscountAmount total discount amount (integer)
 * @returns array of net_total per item (integers)
 */
export function allocateDiscount(
  items: { unit_price: number; qty: number }[],
  totalDiscountAmount: number
): number[] {
  if (items.length === 0) return [];

  const grossAmounts = items.map((item) => item.unit_price * item.qty);
  const totalGross = grossAmounts.reduce((sum, g) => sum + g, 0);

  if (totalGross === 0) {
    const zeroResults = new Array(items.length).fill(0);
    const rem = totalDiscountAmount;
    if (items.length > 0) {
      zeroResults[items.length - 1] = -rem;
    }
    return items.map((item, i) => item.unit_price * item.qty - (i === items.length - 1 ? totalDiscountAmount : 0));
  }

  let allocatedDiscount = 0;
  const netTotals: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const gross = grossAmounts[i]!;
    const isLast = i === items.length - 1;

    let lineDiscount: number;
    if (isLast) {
      lineDiscount = totalDiscountAmount - allocatedDiscount;
    } else {
      lineDiscount = Math.round((gross / totalGross) * totalDiscountAmount);
      allocatedDiscount += lineDiscount;
    }

    const net = gross - lineDiscount;
    netTotals.push(Math.max(0, net));
  }

  return netTotals;
}

/**
 * Calculate refund amount for a returned item.
 * SPEC §8.5: refund_amount per line = round(net_total x qty_returned / qty_sold).
 */
export function calcRefundAmount(netTotal: number, qtyReturned: number, qtySold: number): number {
  if (qtySold <= 0 || qtyReturned <= 0) return 0;
  if (qtyReturned >= qtySold) return netTotal;
  return Math.round((netTotal * qtyReturned) / qtySold);
}
