/**
 * Report repository (P&L and financial metrics per SPEC §8.10).
 */
import { DbAdapter } from '../db-adapter.js';
import { ProfitAndLoss, TopItem } from '../types/schemas.js';

export class ReportRepo {
  constructor(private db: DbAdapter) {}

  async getProfitAndLoss(shopId: string, startDate: string, endDate: string): Promise<ProfitAndLoss> {
    const startStr = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    const endStr = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
    const dateOnlyStart = startDate.substring(0, 10);
    const dateOnlyEnd = endDate.substring(0, 10);

    // 1. Sales stats & payment method split
    const salesStats = await this.db.query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(total), 0) AS total_revenue,
         COUNT(*) AS sales_count,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
         COALESCE(SUM(CASE WHEN payment_method = 'online' THEN total ELSE 0 END), 0) AS online_total
       FROM sales
       WHERE shop_id = ? AND deleted_at IS NULL AND sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    );

    const sStat = salesStats[0] || {};
    const grossRevenue = Number(sStat['total_revenue'] || 0);
    const salesCount = Number(sStat['sales_count'] || 0);
    const cashTotal = Number(sStat['cash_total'] || 0);
    const onlineTotal = Number(sStat['online_total'] || 0);
    const avgSaleValue = salesCount > 0 ? Math.round(grossRevenue / salesCount) : 0;

    // 2. Returns refund amount
    const returnsStats = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(refund_amount), 0) AS total_refunds
       FROM returns
       WHERE shop_id = ? AND deleted_at IS NULL AND returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    );
    const totalRefunds = Number(returnsStats[0]?.['total_refunds'] || 0);

    const netRevenue = grossRevenue - totalRefunds;

    // 3. Net COGS: sum(sale_items.qty * unit_cost by sold_at) minus sum(return_items.qty * unit_cost where restocked, by returned_at)
    const salesCogs = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) AS total_cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.shop_id = ? AND si.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    );
    const grossCogs = Number(salesCogs[0]?.['total_cogs'] || 0);

    const returnsCogs = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(ri.qty * ri.unit_cost), 0) AS restocked_cogs
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.shop_id = ? AND ri.deleted_at IS NULL AND ri.restocked = 1 AND r.returned_at BETWEEN ? AND ?`,
      [shopId, startStr, endStr]
    );
    const restockedCogs = Number(returnsCogs[0]?.['restocked_cogs'] || 0);

    const netCogs = grossCogs - restockedCogs;

    // 4. Gross profit = Net revenue minus Net COGS
    const grossProfit = netRevenue - netCogs;

    // 5. Expenses total
    const expenseStats = await this.db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses
       FROM expenses
       WHERE shop_id = ? AND deleted_at IS NULL AND expense_date BETWEEN ? AND ?`,
      [shopId, dateOnlyStart, dateOnlyEnd]
    );
    const expensesTotal = Number(expenseStats[0]?.['total_expenses'] || 0);

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

  async getTopItemsByQty(shopId: string, startDate: string, endDate: string, limit = 10): Promise<TopItem[]> {
    const startStr = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    const endStr = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;

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
      [shopId, startStr, endStr, limit]
    );

    return rows.map((r) => ({
      variant_id: String(r['variant_id']),
      product_name: String(r['product_name']),
      variant_name: String(r['variant_name']),
      value: Number(r['value']),
    }));
  }

  async getTopItemsByProfit(shopId: string, startDate: string, endDate: string, limit = 10): Promise<TopItem[]> {
    const startStr = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    const endStr = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;

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
      [shopId, startStr, endStr, limit]
    );

    return rows.map((r) => ({
      variant_id: String(r['variant_id']),
      product_name: String(r['product_name']),
      variant_name: String(r['variant_name']),
      value: Number(r['value']),
    }));
  }

  async getDailySeries(shopId: string, startDate: string, endDate: string): Promise<{ date: string; revenue: number; profit: number }[]> {
    const startStr = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    const endStr = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;

    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT
         SUBSTR(s.sold_at, 1, 10) AS date,
         SUM(s.total) AS revenue,
         SUM(si_agg.total_net - si_agg.total_cogs) AS profit
       FROM sales s
       JOIN (
         SELECT sale_id, SUM(net_total) AS total_net, SUM(qty * unit_cost) AS total_cogs
         FROM sale_items
         WHERE deleted_at IS NULL
         GROUP BY sale_id
       ) si_agg ON si_agg.sale_id = s.id
       WHERE s.shop_id = ? AND s.deleted_at IS NULL AND s.sold_at BETWEEN ? AND ?
       GROUP BY SUBSTR(s.sold_at, 1, 10)
       ORDER BY date ASC`,
      [shopId, startStr, endStr]
    );

    return rows.map((r) => ({
      date: String(r['date']),
      revenue: Number(r['revenue']),
      profit: Number(r['profit']),
    }));
  }
}
