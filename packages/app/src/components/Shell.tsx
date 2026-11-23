import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useDb, usePlatform } from '../context/DbProvider';
import { StockRepo, ShopRepo, DeviceRepo } from '@vaporflow/core';
import { ProductsScreen } from '../screens/ProductsScreen';
import { StockScreen } from '../screens/StockScreen';
import { SaleScreen, useSaleDraft } from '../screens/SaleScreen';
import { SalesScreen } from '../screens/SalesScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { ExpensesScreen } from '../screens/ExpensesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Icon } from './Icon';
import { SyncBadge } from './SyncBadge';
import { Sheet } from './Sheet';
import { LockScreen } from './LockScreen';
import { UpdateBanner } from './UpdateBanner';
import { useSecurity } from './use-security';
import { globalErrorLogger } from '../utils/logger';
import { STOCK_CHANGED_EVENT } from '../utils/stock-events';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { handleBackThroughDialogs, isSaleCartActive, abandonSaleCart } from '../utils/back-nav';

export function Shell() {
  const db = useDb();
  const { platform } = usePlatform();
  const location = useLocation();

  const [lowStockCount, setLowStockCount] = useState(0);
  const [shopName, setShopName] = useState('VaporFlow');
  const [deviceCode, setDeviceCode] = useState('');
  const [currency, setCurrency] = useState('');
  const security = useSecurity();
  const draft = useSaleDraft();

  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void App.addListener('backButton', ({ canGoBack }) => {
      // Locked: the lock screen owns the screen; back does nothing.
      if (security.locked) return;
      // Open dialogs first (LIFO registry: receipt, returns, restore, editors…).
      if (handleBackThroughDialogs()) return;
      if (moreOpen) {
        setMoreOpen(false);
        return;
      }
      // Sale root: confirm only when a cart actually holds items, then clear
      // the confirmed-abandoned cart and exit to the launcher (history.back()
      // at the root would no-op).
      if (location.pathname === '/') {
        if (isSaleCartActive()) {
          if (!window.confirm('Abandon this sale? The cart will be cleared.')) {
            return;
          }
          abandonSaleCart();
        }
        void App.minimizeApp();
        return;
      }
      if (canGoBack) {
        window.history.back();
        return;
      }
      void App.minimizeApp();
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle?.remove();
    };
    // isSaleCartActive and the dialog registry are module state read at event
    // time, so they need no effect deps.
  }, [moreOpen, security.locked, location.pathname]);

  useEffect(() => {
    let active = true;
    async function loadMeta() {
      try {
        const stockRepo = new StockRepo(db);

        const activeShop = await new ShopRepo(db).getActiveShop();
        const shopId = activeShop?.id;
        if (shopId && active) {
          const low = await stockRepo.getLowStockVariants(shopId);
          const device = await new DeviceRepo(db).getActiveDevice(shopId);
          if (!active) return;
          setShopName(activeShop.name);
          setCurrency(activeShop.currency_code);
          setDeviceCode(device?.code ?? '');
          setLowStockCount(low.length);
        }
      } catch (err) {
        globalErrorLogger.log(err);
      }
    }
    loadMeta();
    const interval = setInterval(loadMeta, 30000);
    const onStockChanged = () => {
      void loadMeta();
    };
    window.addEventListener(STOCK_CHANGED_EVENT, onStockChanged);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener(STOCK_CHANGED_EVENT, onStockChanged);
    };
  }, [db, location.pathname]);

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
    { icon: 'shoppingCart', label: 'Sale', path: '/' },
    { icon: 'package', label: 'Products', path: '/products' },
    { icon: 'layers', label: 'Stock', path: '/stock', badge: lowStockCount },
    { icon: 'receipt', label: 'Sales', path: '/sales' },
    { icon: 'barChart', label: 'Reports', path: '/reports' },
    { icon: 'wallet', label: 'Expenses', path: '/expenses' },
    { icon: 'settings', label: 'Settings', path: '/settings' },
  ] as const;
  const activeItem = navItems.find((item) => item.path === location.pathname);

  return (
    <div className="pos-shell" data-platform={platform}>
      <aside className="pos-sidebar">
        <div className="pos-brand">
          <span className="brand-mark">
            <Icon name="zap" />
          </span>
          <div className="min-w-0">
            <strong>VaporFlow</strong>
            <small>{shopName}</small>
          </div>
        </div>
        <nav aria-label="Desktop navigation">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              aria-current={activeItem === item ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
              {'badge' in item && item.badge > 0 && (
                <span className="stock-count">{item.badge}</span>
              )}
            </Link>
          ))}
        </nav>
        <footer>
          <span>
            Device <b>{deviceCode}</b>
          </span>
          <b>{currency}</b>
        </footer>
      </aside>
      <div className="pos-workspace">
        <header className="pos-header">
          <span className="brand-mark md:hidden">
            <Icon name="zap" />
          </span>
          <div className="min-w-0 flex-1">
            <h1>{activeItem?.label ?? 'Sale'}</h1>
            <small className="block">
              {shopName} · {platform === 'android' ? 'Android POS' : 'Offline-first SQLite'}
            </small>
          </div>
          {lowStockCount > 0 && (
            <Link
              className="hidden lg:inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
              to="/stock"
            >
              {lowStockCount} low stock
            </Link>
          )}
          <SyncBadge />
          {security.enabled && (
            <button onClick={security.lock} className="icon-button" aria-label="Lock screen">
              <Icon name="lock" />
            </button>
          )}
        </header>
        <UpdateBanner duringSale={location.pathname === '/' || draft.cart.length > 0} />
        <main className="pos-main" key={location.pathname}>
          <Routes>
            <Route path="/" element={<SaleScreen draft={draft} />} />
            <Route path="/products" element={<ProductsScreen />} />
            <Route path="/stock" element={<StockScreen />} />
            <Route path="/sales" element={<SalesScreen />} />
            <Route path="/reports" element={<ReportsScreen />} />
            <Route path="/expenses" element={<ExpensesScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Routes>
        </main>
      </div>

      <nav aria-label="Mobile Navigation" className="phone-nav">
        {navItems.slice(0, 4).map((item) => (
          <Link
            key={item.path}
            to={item.path}
            aria-current={activeItem === item ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {'badge' in item && item.badge > 0 && <b className="stock-count">{item.badge}</b>}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={navItems.slice(4).some((item) => item === activeItem) ? 'selected' : ''}
        >
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <Sheet title="More" onClose={() => setMoreOpen(false)}>
          {navItems.slice(4).map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="more-link"
              onClick={() => setMoreOpen(false)}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </Sheet>
      )}
    </div>
  );
}
