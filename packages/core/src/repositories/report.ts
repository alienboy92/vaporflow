import { z } from 'zod';
import { reportRange, localDate } from '../dates.js';
import { addMoney, safeInteger, roundRatio, fromInteger } from '../money.js';
import { IdSchema, TimestampSchema, ProfitAndLoss, TopItem } from '../types/schemas.js';
import { DbAdapter } from '../db-adapter.js';
/**
 * Report repository (P&L and financial metrics per SPEC §8.10).
 */

export class ReportRepo {
  constructor(private db: DbAdapter) {}

  async getProfitAndLoss(
    shopId: string,
    startDate: string,
    endDate: string,
  ): Promise<ProfitAndLoss> {
    IdSchema.parse(shopId);
    const { startStr, endStr, dateOnlyStart, dateOnlyEnd } = reportRange(startDate, endDate);

    // 1. Sales stats & payment method split
    const salesStats = await this.db.query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(total), 0) AS total_revenue,
         COUNT(*) AS sales_count,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
         COALESCE(SUM(CASE WHEN payment_method = 'online' THEN total ELSE 0 END), 0) AS online_total
       FROM sales
       WHERE shop_id = ? AND deleted_at IS NULL AND sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr],
    );

    const sStat = salesStats[0] || {};
    const grossRevenue = safeInteger(Number(sStat['total_revenue'] || 0));
    const salesCount = safeInteger(Number(sStat['sales_count'] || 0));
    const cashTotal = safeInteger(Number(sStat['cash_total'] || 0));
    const onlineTotal = safeInteger(Number(sStat['online_total'] || 0));
    const avgSaleValue =
      salesCount > 0 ? fromInteger(roundRatio(BigInt(grossRevenue), BigInt(salesCount))) : 0;

    // 2. Returns refund amount
    const returnsStats = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(refund_amount), 0) AS total_refunds
       FROM returns
       WHERE shop_id = ? AND deleted_at IS NULL AND returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr],
    );
    const totalRefunds = safeInteger(Number(returnsStats[0]?.['total_refunds'] || 0));

    const netRevenue = addMoney(grossRevenue, -totalRefunds);

    // 3. Net COGS: sum(sale_items.qty * unit_cost by sold_at) minus sum(return_items.qty * unit_cost where restocked, by returned_at)
    const salesCogs = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) AS total_cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.shop_id = ? AND si.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr],
    );
    const grossCogs = safeInteger(Number(salesCogs[0]?.['total_cogs'] || 0));

    const returnsCogs = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(ri.qty * ri.unit_cost), 0) AS restocked_cogs
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.shop_id = ? AND ri.deleted_at IS NULL AND ri.restocked = 1 AND r.returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr],
    );
    const restockedCogs = safeInteger(Number(returnsCogs[0]?.['restocked_cogs'] || 0));

    const netCogs = addMoney(grossCogs, -restockedCogs);

    // 4. Gross profit = Net revenue minus Net COGS
    const grossProfit = addMoney(netRevenue, -netCogs);

    // 5. Expenses total
    const expenseStats = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses
       FROM expenses
       WHERE shop_id = ? AND deleted_at IS NULL AND expense_date BETWEEN ? AND ?`,
      [shopId, dateOnlyStart, dateOnlyEnd],
    );
    const expensesTotal = safeInteger(Number(expenseStats[0]?.['total_expenses'] || 0));

    // 6. Net profit = Gross profit minus expenses
    const netProfit = addMoney(grossProfit, -expensesTotal);

    return {
      net_revenue: netRevenue,
      net_cogs: netCogs,
      gross_profit: grossProfit,
      expenses_total: expensesTotal,
      net_profit: netProfit,
      sales_count: salesCount,
      avg_sale_value: avgSaleValue,
      cash_total: cashTotal,
      online_total: onlineTotal,
    };
  }

  async getTopItemsByQty(
    shopId: string,
    startDate: string,
    endDate: string,
    limit = 10,
  ): Promise<TopItem[]> {
    IdSchema.parse(shopId);
    const { startStr, endStr } = reportRange(startDate, endDate);

    if (!Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new Error('Limit must be 1 to 10');
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT
         si.variant_id,
         si.product_name,
         si.variant_name,
         SUM(si.qty) AS value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.shop_id = ? AND si.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?
       GROUP BY si.variant_id, si.product_name, si.variant_name
       ORDER BY value DESC
       LIMIT ?`,
      [shopId, startStr, endStr, limit],
    );

    return rows.map((r) => ({
      variant_id: String(r['variant_id']),
      product_name: String(r['product_name']),
      variant_name: String(r['variant_name']),
      value: safeInteger(Number(r['value'])),
    }));
  }

  async getTopItemsByProfit(
    shopId: string,
    startDate: string,
    endDate: string,
    limit = 10,
  ): Promise<TopItem[]> {
    IdSchema.parse(shopId);
    const { startStr, endStr } = reportRange(startDate, endDate);

    if (!Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new Error('Limit must be 1 to 10');
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT
         si.variant_id,
         si.product_name,
         si.variant_name,
         SUM(si.net_total - (si.qty * si.unit_cost)) AS value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.shop_id = ? AND si.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?
       GROUP BY si.variant_id, si.product_name, si.variant_name
       ORDER BY value DESC
       LIMIT ?`,
      [shopId, startStr, endStr, limit],
    );

    return rows.map((r) => ({
      variant_id: String(r['variant_id']),
      product_name: String(r['product_name']),
      variant_name: String(r['variant_name']),
      value: safeInteger(Number(r['value'])),
    }));
  }

  /** Daily net revenue and net profit, including returns and expenses on their own dates. */
  async getDailySeries(
    shopId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ date: string; revenue: number; profit: number }[]> {
    IdSchema.parse(shopId);
    const { startStr, endStr, dateOnlyStart, dateOnlyEnd } = reportRange(startDate, endDate);
    const schema = z.object({
      at: TimestampSchema,
      revenue: z.number().int(),
      profit: z.number().int(),
    });
    const events = schema.array().parse(
      await this.db.query(
        `SELECT s.sold_at AS at, s.total AS revenue,
         s.total - COALESCE((SELECT SUM(qty * unit_cost) FROM sale_items WHERE sale_id = s.id), 0) AS profit
       FROM sales s WHERE s.shop_id = ? AND s.sold_at BETWEEN ? AND ?
       UNION ALL
       SELECT r.returned_at AS at, -r.refund_amount AS revenue,
         -r.refund_amount + COALESCE((SELECT SUM(qty * unit_cost) FROM return_items WHERE return_id = r.id AND restocked = 1), 0) AS profit
       FROM returns r WHERE r.shop_id = ? AND r.returned_at BETWEEN ? AND ?`,
        [shopId, startStr, endStr, shopId, startStr, endStr],
      ),
    );
    const days = new Map<string, { date: string; revenue: number; profit: number }>();
    const day = new Date(startStr);
    day.setHours(12, 0, 0, 0);
    while (localDate(day) <= dateOnlyEnd) {
      const date = localDate(day);
      days.set(date, { date, revenue: 0, profit: 0 });
      day.setDate(day.getDate() + 1);
    }
    for (const event of events) {
      const target = days.get(localDate(new Date(event.at)))!;
      target.revenue = addMoney(target.revenue, event.revenue);
      target.profit = addMoney(target.profit, event.profit);
    }
    const expenses = z
      .object({ expense_date: z.iso.date(), amount: z.number().int() })
      .array()
      .parse(
        await this.db.query(
          'SELECT expense_date, amount FROM expenses WHERE shop_id = ? AND deleted_at IS NULL AND expense_date BETWEEN ? AND ?',
          [shopId, dateOnlyStart, dateOnlyEnd],
        ),
      );
    for (const expense of expenses) {
      const target = days.get(expense.expense_date)!;
      target.profit = addMoney(target.profit, -expense.amount);
    }
    return [...days.values()];
  }
}
