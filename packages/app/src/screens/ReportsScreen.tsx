import { useEffect, useState, useCallback } from 'react';
import { useDb } from '../context/DbProvider';
import {
  ShopRepo,
  ReportRepo,
  formatMoney,
  localDate,
} from '@vaporflow/core';
import type { Shop, ProfitAndLoss, TopItem } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

export function ReportsScreen() {
  const db = useDb();
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Date range presets / custom range
  const [preset, setPreset] = useState<'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom'>('thisMonth');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Report data
  const [pnl, setPnl] = useState<ProfitAndLoss | null>(null);
  const [topQty, setTopQty] = useState<TopItem[]>([]);
  const [topProfit, setTopProfit] = useState<TopItem[]>([]);
  const [dailySeries, setDailySeries] = useState<{ date: string; revenue: number; profit: number }[]>([]);

  // Compute preset dates
  const updateRangeByPreset = useCallback((p: 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth') => {
    const now = new Date();
    const todayStr = localDate(now);

    if (p === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (p === 'yesterday') {
      const yest = new Date(now);
      yest.setDate(yest.getDate() - 1);
      const yestStr = localDate(yest);
      setStartDate(yestStr);
      setEndDate(yestStr);
    } else if (p === 'last7') {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setStartDate(localDate(start));
      setEndDate(todayStr);
    } else if (p === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(localDate(start));
      setEndDate(todayStr);
    } else if (p === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(localDate(start));
      setEndDate(localDate(end));
    }
  }, []);

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
      const topQ = await reportRepo.getTopItemsByQty(activeShop.id, startDate, endDate, 10);
      const topP = await reportRepo.getTopItemsByProfit(activeShop.id, startDate, endDate, 10);
      const series = await reportRepo.getDailySeries(activeShop.id, startDate, endDate);

      setPnl(pnlData);
      setTopQty(topQ);
      setTopProfit(topP);
      setDailySeries(series);
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
    return <div className="p-6 text-gray-600">Loading reports...</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Profit & Loss Reports</h1>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Date Range Controls */}
      <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {(['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth'] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPreset(p);
                updateRangeByPreset(p);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium min-h-11 transition-colors ${
                preset === p ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p === 'today' && 'Today'}
              {p === 'yesterday' && 'Yesterday'}
              {p === 'last7' && 'Last 7 Days'}
              {p === 'thisMonth' && 'This Month'}
              {p === 'lastMonth' && 'Last Month'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setPreset('custom');
                setStartDate(e.target.value);
              }}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setPreset('custom');
                setEndDate(e.target.value);
              }}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* P&L Cards (SPEC §8.10) */}
      {pnl && (
        <div className="report-metrics grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-white p-5 rounded-xl border shadow-sm space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Revenue</span>
            <div className="text-2xl font-bold text-gray-900">{formatMoney(pnl.net_revenue, 0, currency)}</div>
            <div className="text-xs text-gray-500">Sales: {pnl.sales_count} | Avg: {formatMoney(pnl.avg_sale_value, 0, currency)}</div>
          </div>

          <div className="bg-white p-5 rounded-xl border shadow-sm space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net COGS</span>
            <div className="text-2xl font-bold text-red-600">-{formatMoney(pnl.net_cogs, 0, currency)}</div>
            <div className="text-xs text-gray-500">Cost of goods sold</div>
          </div>

          <div className="bg-white p-5 rounded-xl border shadow-sm space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Profit</span>
            <div className="text-2xl font-bold text-emerald-700">{formatMoney(pnl.gross_profit, 0, currency)}</div>
            <div className="text-xs text-gray-500">Revenue minus COGS</div>
          </div>

          <div className="bg-white p-4 rounded-xl border shadow-sm flex justify-between items-center">
            <div>
              <span className="text-xs font-medium text-gray-500">Total Expenses</span>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{formatMoney(pnl.expenses_total, 0, currency)}</div>
            </div>
          </div>
          <div data-negative={pnl.net_profit < 0} className="bg-white p-5 rounded-xl border shadow-sm space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Profit</span>
            <div className={`text-2xl font-bold ${pnl.net_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatMoney(pnl.net_profit, 0, currency)}
            </div>
            <div className="text-xs text-gray-500">Gross profit minus expenses</div>
          </div>
        </div>
      )}

      {/* Secondary Metrics Cards */}
      {pnl && (
        <div className="grid grid-cols-2 gap-3">

          <div className="bg-white p-4 rounded-xl border shadow-sm flex justify-between items-center">
            <div>
              <span className="text-xs font-medium text-gray-500">Cash Sales Total</span>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{formatMoney(pnl.cash_total, 0, currency)}</div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border shadow-sm flex justify-between items-center">
            <div>
              <span className="text-xs font-medium text-gray-500">Online / Card Sales Total</span>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{formatMoney(pnl.online_total, 0, currency)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Daily Performance Chart */}
      <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
        <h3 className="text-lg font-bold text-gray-900">Daily Revenue & Profit Trend</h3>
        {dailySeries.length === 0 ? (
          <div className="py-12 text-center text-gray-400">No data available for the selected date range.</div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailySeries} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" stroke="#888888" fontSize={12} />
                <YAxis stroke="#888888" fontSize={12} />
                <Tooltip
                  formatter={(value: number) => formatMoney(value, 0, currency)}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#059669" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="profit" name="Net Profit" stroke="#334155" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top 10 Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Items by Qty */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-900">Top 10 Items by Quantity Sold</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  <th className="pb-3">Product / Variant</th>
                  <th className="pb-3 text-right">Qty Sold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {topQty.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-gray-400">No sales recorded</td>
                  </tr>
                ) : (
                  topQty.map((item, idx) => (
                    <tr key={item.variant_id} className="hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-900">
                        {idx + 1}. {item.product_name} <span className="text-gray-500 text-xs font-normal">({item.variant_name})</span>
                      </td>
                      <td className="py-3 text-right font-bold text-emerald-700">{item.value}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Items by Profit */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-900">Top 10 Items by Gross Profit</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  <th className="pb-3">Product / Variant</th>
                  <th className="pb-3 text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {topProfit.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-gray-400">No sales recorded</td>
                  </tr>
                ) : (
                  topProfit.map((item, idx) => (
                    <tr key={item.variant_id} className="hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-900">
                        {idx + 1}. {item.product_name} <span className="text-gray-500 text-xs font-normal">({item.variant_name})</span>
                      </td>
                      <td className="py-3 text-right font-bold text-green-700">{formatMoney(item.value, 0, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
