import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useDb } from '../context/DbProvider';
import { StockRepo, ShopRepo } from '@vaporflow/core';
import {
  SalePlaceholder,
  ProductsPlaceholder,
  StockPlaceholder,
  SalesPlaceholder,
  ReportsPlaceholder,
  ExpensesPlaceholder,
} from '../screens/PlaceholderScreens';
import { SettingsScreen } from '../screens/SettingsScreen';
import { LockScreen } from './LockScreen';
import { useSecurity } from './use-security';
import { globalErrorLogger } from '../utils/logger';

export function Shell() {
  const db = useDb();
  const location = useLocation();

  const [lowStockCount, setLowStockCount] = useState(0);
  const security = useSecurity();

  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadMeta() {
      try {
        const stockRepo = new StockRepo(db);

        const activeShop = await new ShopRepo(db).getActiveShop();
        const shopId = activeShop?.id;
        if (shopId && active) {
          const low = await stockRepo.getLowStockVariants(shopId);
          setLowStockCount(low.length);
        }
      } catch (err) {
        globalErrorLogger.log(err);
      }
    }
    loadMeta();
    const interval = setInterval(loadMeta, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [db]);

  if (security.error)
    return (
      <main className="p-6">
        <p role="alert">Could not load security settings.</p>
        <button className="min-h-11 px-4 border" onClick={security.retry}>
          Retry
        </button>
      </main>
    );
  if (!security.ready)
    return (
      <main className="p-6" role="status">
        Loading security settings…
      </main>
    );
  if (security.locked)
    return (
      <LockScreen
        onUnlock={() => {
          setMoreOpen(false);
          security.unlock();
        }}
      />
    );

  const navItems = [
    { label: 'Sale', path: '/' },
    { label: 'Products', path: '/products' },
    { label: 'Stock', path: '/stock', badge: lowStockCount },
    { label: 'Sales', path: '/sales' },
    { label: 'Reports', path: '/reports' },
    { label: 'Expenses', path: '/expenses' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-gray-900 text-white shrink-0">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold tracking-wide">VaporFlow</h1>
          <span className="text-xs text-gray-400">Offline POS</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center justify-between px-4 py-3 rounded-lg min-h-11 text-base font-medium transition-colors ${
                  active
                    ? 'bg-blue-700 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <button
            disabled={!security.enabled}
            onClick={security.lock}
            className="w-full flex items-center justify-center px-4 py-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 min-h-11 text-sm font-medium"
          >
            Lock Screen
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">
        {/* Header Slot */}
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-gray-800 md:hidden">VaporFlow</span>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-amber-500 inline-block" />
              <span className="text-sm font-medium text-gray-600">Offline (Local Only)</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {lowStockCount > 0 && (
              <Link
                to="/stock"
                className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1.5 rounded-full text-sm font-medium border border-red-200"
              >
                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
                {lowStockCount} low stock
              </Link>
            )}
            <button
              disabled={!security.enabled}
              onClick={security.lock}
              className="md:hidden text-sm font-medium text-gray-600 border px-3 py-1.5 rounded min-h-11"
            >
              Lock
            </button>
          </div>
        </header>

        {/* Routes */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<SalePlaceholder />} />
            <Route path="/products" element={<ProductsPlaceholder />} />
            <Route path="/stock" element={<StockPlaceholder />} />
            <Route path="/sales" element={<SalesPlaceholder />} />
            <Route path="/reports" element={<ReportsPlaceholder />} />
            <Route path="/expenses" element={<ExpensesPlaceholder />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Routes>
        </main>
      </div>

      {/* Android Bottom Bar (SPEC 9.1) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around items-center h-16 z-40 px-2"
      >
        <Link
          to="/"
          className={`flex flex-col items-center justify-center flex-1 py-1 min-h-11 ${location.pathname === '/' ? 'text-blue-700 font-bold' : 'text-gray-600'}`}
        >
          <span className="text-xs">Sale</span>
        </Link>
        <Link
          to="/products"
          className={`flex flex-col items-center justify-center flex-1 py-1 min-h-11 ${location.pathname === '/products' ? 'text-blue-700 font-bold' : 'text-gray-600'}`}
        >
          <span className="text-xs">Products</span>
        </Link>
        <Link
          to="/stock"
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-11 ${location.pathname === '/stock' ? 'text-blue-700 font-bold' : 'text-gray-600'}`}
        >
          <span className="text-xs">Stock</span>
          {lowStockCount > 0 && (
            <span className="absolute top-1 right-3 bg-red-600 text-white text-[10px] px-1.5 rounded-full font-bold">
              {lowStockCount}
            </span>
          )}
        </Link>
        <Link
          to="/sales"
          className={`flex flex-col items-center justify-center flex-1 py-1 min-h-11 ${location.pathname === '/sales' ? 'text-blue-700 font-bold' : 'text-gray-600'}`}
        >
          <span className="text-xs">Sales</span>
        </Link>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={`flex flex-col items-center justify-center flex-1 py-1 min-h-11 ${moreOpen ? 'text-blue-700 font-bold' : 'text-gray-600'}`}
        >
          <span className="text-xs">More</span>
        </button>
      </nav>

      {/* Android More Drawer */}
      {moreOpen && (
        <div className="md:hidden fixed inset-x-0 bottom-16 bg-white border-t shadow-2xl p-4 z-50 space-y-2 rounded-t-xl">
          <Link
            to="/reports"
            onClick={() => setMoreOpen(false)}
            className="block p-3 rounded hover:bg-gray-100 font-medium text-gray-800 min-h-11 flex items-center"
          >
            Reports (P&L)
          </Link>
          <Link
            to="/expenses"
            onClick={() => setMoreOpen(false)}
            className="block p-3 rounded hover:bg-gray-100 font-medium text-gray-800 min-h-11 flex items-center"
          >
            Expenses
          </Link>
          <Link
            to="/settings"
            onClick={() => setMoreOpen(false)}
            className="block p-3 rounded hover:bg-gray-100 font-medium text-gray-800 min-h-11 flex items-center"
          >
            Settings
          </Link>
        </div>
      )}
    </div>
  );
}
