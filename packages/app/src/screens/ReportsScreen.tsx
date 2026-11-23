import { useEffect, useState, useCallback } from 'react';
import { useDb } from '../context/DbProvider';
import {
  ShopRepo,
  ReportRepo,
  ExpenseRepo,
  formatMoney,
  localDate,
} from '@vaporflow/core';
import type { Shop, ProfitAndLoss, TopItemDetail } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

type Preset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'all' | 'custom';

const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'all', label: 'All Time' },
];

/** Earliest supported date for the "All Time" report preset. */
const ALL_TIME_START = '2000-01-01';

export function ReportsScreen() {
  const db = useDb();
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Date range presets / custom range
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Report data
  const [pnl, setPnl] = useState<ProfitAndLoss | null>(null);
  const [expenseCount, setExpenseCount] = useState(0);
  const [topByProfit, setTopByProfit] = useState<TopItemDetail[]>([]);
  const [topByQty, setTopByQty] = useState<TopItemDetail[]>([]);
  const [topSort, setTopSort] = useState<'profit' | 'qty'>('profit');
  const [dailySeries, setDailySeries] = useState<{ date: string; revenue: number; profit: number }[]>([]);

  // Compute preset dates
  const updateRangeByPreset = useCallback(
    (next: Exclude<Preset, 'custom'>) => {
      const todayStr = localDate(new Date());
      const now = new Date(todayStr + 'T00:00:00Z');

      if (next === 'today') {
        setStartDate(todayStr);
        setEndDate(todayStr);
      } else if (next === 'yesterday') {
        const yest = new Date(now);
        yest.setUTCDate(yest.getUTCDate() - 1);
        const yestStr = localDate(yest);
        setStartDate(yestStr);
        setEndDate(yestStr);
      } else if (next === 'last7') {
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 6);
        setStartDate(localDate(start));
        setEndDate(todayStr);
      } else if (next === 'thisMonth') {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        setStartDate(localDate(start));
        setEndDate(todayStr);
      } else if (next === 'lastMonth') {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
        setStartDate(localDate(start));
        setEndDate(localDate(end));
      } else {
        setStartDate(ALL_TIME_START);
        setEndDate(todayStr);
      }
    },
    [],
  );

  useEffect(() => {
    updateRangeByPreset('thisMonth');
  }, [updateRangeByPreset]);

  const loadReports = useCallback(async () => {
    if (!startDate || !endDate) return;
    try {
      const shopRepo = new ShopRepo(db);
      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);

      const reportRepo = new ReportRepo(db);
      const pnlData = await reportRepo.getProfitAndLoss(activeShop.id, startDate, endDate);
      const topP = await reportRepo.getTopItems(activeShop.id, startDate, endDate, 'profit', 10);
      const topQ = await reportRepo.getTopItems(activeShop.id, startDate, endDate, 'qty', 10);
      const series = await reportRepo.getDailySeries(activeShop.id, startDate, endDate);
      const expenses = await new ExpenseRepo(db).getAll(activeShop.id, startDate, endDate);

      setPnl(pnlData);
      setTopByProfit(topP);
      setTopByQty(topQ);
      setDailySeries(series);
      setExpenseCount(expenses.length);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [db, startDate, endDate]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  if (loading) {
    return <div className="vf-page text-sm text-slate-500">Loading reports…</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;
  const fmt = (value: number) => formatMoney(value, decimals, currency);

  const netRevenue = pnl?.net_revenue ?? 0;
  const grossProfit = pnl?.gross_profit ?? 0;
  const netProfit = pnl?.net_profit ?? 0;
  const cashTotal = pnl?.cash_total ?? 0;
  const onlineTotal = pnl?.online_total ?? 0;
  const refundsTotal = pnl?.refunds_total ?? 0;
  const paySum = cashTotal + onlineTotal;
  const cashPct = paySum > 0 ? Math.round((cashTotal / paySum) * 100) : 50;
  const onlinePct = paySum > 0 ? 100 - cashPct : 50;
  const marginPct = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 100) : 0;
  const topItems = topSort === 'profit' ? topByProfit : topByQty;
  // Long ranges (especially All Time) stay readable and cheap to render.
  const chartData = dailySeries.length > 31 ? dailySeries.slice(-14) : dailySeries;
  const chartCaption =
    dailySeries.length > 31 ? 'Last 14 days of the selected range' : 'Daily performance';

  return (
    <div className="vf-page">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {/* Date preset pills + custom range */}
      <section className="vf-card flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              onClick={() => {
                setPreset(p.id);
                updateRangeByPreset(p.id);
              }}
              className="vf-chip min-h-10"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="vf-label" htmlFor="report-start">
              Start Date
            </label>
            <input
              id="report-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setPreset('custom');
                setStartDate(e.target.value);
              }}
              className="vf-input"
            />
          </div>
          <div>
            <label className="vf-label" htmlFor="report-end">
              End Date
            </label>
            <input
              id="report-end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setPreset('custom');
                setEndDate(e.target.value);
              }}
              className="vf-input"
            />
          </div>
        </div>
      </section>

      {/* Primary P&L KPI cards */}
      {pnl && (
        <div className="report-metrics grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="vf-card-pad">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Net Revenue
            </div>
            <div className="vf-num mt-1 text-2xl font-bold text-slate-900">
              {fmt(pnl.net_revenue)}
            </div>
            <div className="vf-sub mt-1">
              {pnl.sales_count} sales · Avg {fmt(pnl.avg_sale_value)}
            </div>
          </div>

          <div className="vf-card-pad">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Net COGS
            </div>
            <div className="vf-num mt-1 text-2xl font-bold text-slate-700">
              {fmt(pnl.net_cogs)}
            </div>
            <div className="vf-sub mt-1">Cost snapshot at sale</div>
          </div>

          <div className="vf-card-pad">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Gross Profit
            </div>
            <div className="vf-num mt-1 text-2xl font-bold text-emerald-700">
              {fmt(pnl.gross_profit)}
            </div>
            <div className="vf-sub mt-1">Margin: {marginPct}%</div>
          </div>

          <div className="vf-card-pad">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Expenses
            </div>
            <div className="vf-num mt-1 text-2xl font-bold text-rose-600">
              {fmt(pnl.expenses_total)}
            </div>
            <div className="vf-sub mt-1">{expenseCount} expense entries</div>
          </div>

          <div
            data-negative={netProfit < 0}
            className={`rounded-2xl border-2 p-5 shadow-sm ${
              netProfit >= 0
                ? 'border-emerald-800 bg-emerald-950 text-white'
                : 'border-rose-800 bg-rose-950 text-white'
            }`}
          >
            <div
              className={`text-[11px] font-bold uppercase tracking-wider ${
                netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              Net Profit
            </div>
            <div className="vf-num mt-1 text-2xl font-bold">{fmt(netProfit)}</div>
            <div
              className={`mt-1 text-xs ${
                netProfit >= 0 ? 'text-emerald-200/80' : 'text-rose-200/80'
              }`}
            >
              Gross Profit − Expenses
            </div>
          </div>
        </div>
      )}

      {/* Payment split + daily chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="vf-card-pad flex flex-col justify-between lg:col-span-5">
          <div>
            <h3 className="font-bold text-slate-900">Payment Method Split</h3>
            <p className="vf-sub mt-0.5">Cash vs Online / Bank Transfer</p>
            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-1 flex justify-between text-sm font-semibold">
                  <span className="text-slate-800">Cash ({cashPct}%)</span>
                  <span className="vf-num text-slate-900">{fmt(cashTotal)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${cashPct}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm font-semibold">
                  <span className="text-slate-800">Online ({onlinePct}%)</span>
                  <span className="vf-num text-slate-900">{fmt(onlineTotal)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-800" style={{ width: `${onlinePct}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
            <span>Refunds Deducted:</span>
            <span className="vf-num font-semibold text-amber-700">{fmt(refundsTotal)}</span>
          </div>
        </div>

        <div className="vf-card-pad lg:col-span-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900">Daily Revenue &amp; Gross Profit</h3>
              <p className="vf-sub">{chartCaption}</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-800" />
                Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                Profit
              </span>
            </div>
          </div>
          {dailySeries.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No data available for the selected date range.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    stroke="#94a3b8"
                    fontSize={11}
                  />
                  <YAxis stroke="#94a3b8" fontSize={11} width={54} />
                  <Tooltip
                    formatter={(value: number) => fmt(value)}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill="#1e293b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Gross Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Combined top items table */}
      <section className="vf-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
          <h3 className="font-bold text-slate-900">
            Top Items by {topSort === 'profit' ? 'Gross Profit' : 'Quantity Sold'}
          </h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-pressed={topSort === 'profit'}
              onClick={() => setTopSort('profit')}
              className="vf-chip min-h-9"
            >
              By Profit
            </button>
            <button
              type="button"
              aria-pressed={topSort === 'qty'}
              onClick={() => setTopSort('qty')}
              className="vf-chip min-h-9"
            >
              By Quantity
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="vf-table">
            <thead>
              <tr>
                <th>Product / Variant</th>
                <th className="text-right">Units Sold</th>
                <th className="text-right">Net Revenue</th>
                <th className="text-right">Gross Profit</th>
              </tr>
            </thead>
            <tbody>
              {topItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    No sales in selected period
                  </td>
                </tr>
              ) : (
                topItems.map((item, index) => (
                  <tr key={`${item.variant_id}-${index}`}>
                    <td className="font-medium text-slate-900">
                      {item.variant_name === 'Default'
                        ? item.product_name
                        : `${item.product_name} (${item.variant_name})`}
                    </td>
                    <td className="vf-num text-right">{item.qty}</td>
                    <td className="vf-num text-right">{fmt(item.revenue)}</td>
                    <td className="vf-num text-right font-bold text-emerald-700">
                      {fmt(item.profit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
