/**
 * Report repository (P&L and financial metrics per SPEC §8.10).
 */
import { DbAdapter } from '../db-adapter.js';
import { ProfitAndLoss } from '../types/schemas.js';

export class ReportRepo {
  constructor(private db: DbAdapter) {}

  getProfitAndLoss(shopId: string, startDate: string, endDate: string): ProfitAndLoss {
    const startStr = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    const endStr = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;

    // 1. Sales stats & payment method split
    const salesStats = this.db.query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(total), 0) AS total_revenue,
         COUNT(*) AS sales_count,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
         COALESCE(SUM(CASE WHEN payment_method = 'online' THEN total ELSE 0 END), 0) AS online_total
       FROM sales
       WHERE shop_id = ? AND deleted_at IS NULL AND sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    )[0];

    const grossRevenue = Number(salesStats?.['total_revenue'] || 0);
    const salesCount = Number(salesStats?.['sales_count'] || 0);
    const cashTotal = Number(salesStats?.['cash_total'] || 0);
    const onlineTotal = Number(salesStats?.['online_total'] || 0);
    const avgSaleValue = salesCount > 0 ? Math.round(grossRevenue / salesCount) : 0;

    // 2. Returns refund amount
    const returnsStats = this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(refund_amount), 0) AS total_refunds
       FROM returns
       WHERE shop_id = ? AND deleted_at IS NULL AND returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    )[0];
    const totalRefunds = Number(returnsStats?.['total_refunds'] || 0);

    const netRevenue = grossRevenue - totalRefunds;

    // 3. Net COGS: sum(sale_items.qty * unit_cost by sold_at) minus sum(return_items.qty * unit_cost where restocked, by returned_at)
    const salesCogs = this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) AS total_cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.shop_id = ? AND si.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    )[0];
    const grossCogs = Number(salesCogs?.['total_cogs'] || 0);

    const returnsCogs = this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(ri.qty * ri.unit_cost), 0) AS restocked_cogs
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.shop_id = ? AND ri.deleted_at IS NULL AND ri.restocked = 1 AND r.returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    )[0];
    const restockedCogs = Number(returnsCogs?.['restocked_cogs'] || 0);

    const netCogs = grossCogs - restockedCogs;

    // 4. Gross profit = Net revenue minus Net COGS
    const grossProfit = netRevenue - netCogs;

    // 5. Expenses total
    const expenseStats = this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses
       FROM expenses
       WHERE shop_id = ? AND deleted_at IS NULL AND expense_date BETWEEN ? AND ?`,
      [shopId, startDate.substring(0, 10), endDate.substring(0, 10)]
    )[0];
    const expensesTotal = Number(expenseStats?.['total_expenses'] || 0);

    // 6. Net profit = Gross profit minus expenses
    const netProfit = grossProfit - expensesTotal;

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
}
