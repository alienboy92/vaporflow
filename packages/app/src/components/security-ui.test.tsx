import { LockScreen } from './LockScreen';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { CloudSyncProvider } from '../context/CloudSyncProvider';
import { Shell } from './Shell';
import { App } from '../App';
import { handleBackThroughDialogs } from '../utils/back-nav';
import { notifyStockChanged } from '../utils/stock-events';
import { uuidv7, hashPin } from '@vaporflow/core';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ db: { query: vi.fn() }, values: {} as Record<string, string> }));
vi.mock('../context/DbProvider', () => ({
  useDb: () => state.db,
  usePlatform: () => ({
    platform: 'android',
    network: { isOnline: () => true, onChange: () => () => {} },
  }),
  DbProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../screens/SettingsScreen', () => ({
  SettingsScreen: () => <div>Shop settings content</div>,
}));
vi.mock('../screens/ReportsScreen', () => ({
  ReportsScreen: () => <div>Reports content</div>,
}));
vi.mock('../screens/SetupWizard', () => ({ SetupWizard: () => <div>First run wizard</div> }));
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }));
  vi.stubGlobal('document', new EventTarget());
  state.values = { pin_hash: 'configured', idle_lock_minutes: '1' };
  state.db.query
    .mockReset()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM settings')
        ? Object.entries(state.values).map(([key, value]) => ({ key, value }))
        : [],
    );
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mountShell(path = '/settings') {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[path]}>
        <CloudSyncProvider><Shell /></CloudSyncProvider>
      </MemoryRouter>,
    );
  });
}
async function enterPin(pin = '1234') {
  await act(async () => {
    renderer!.root.findByProps({ 'aria-label': 'PIN' }).props.onChange({
      target: { value: pin },
    });
  });
  await act(async () => {
    await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} });
  });
}
it('requires PIN on startup and removes navigation and protected routes while locked', async () => {
  await mountShell();
  expect(JSON.stringify(renderer!.toJSON())).toContain('VaporFlow Locked');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('Shop settings content');
  expect(renderer!.root.findAllByType('nav')).toHaveLength(0);
});
it('fails closed when security settings cannot be read', async () => {
  state.db.query.mockRejectedValue(new Error('database read failed'));
  await mountShell();
  expect(JSON.stringify(renderer!.toJSON())).toContain('Could not load security settings');
  expect(renderer!.root.findAllByType('nav')).toHaveLength(0);
});
it('refreshes the low-stock badge immediately when notified of stock changes', async () => {
  const shopRow = {
    id: uuidv7(),
    shop_id: '',
    name: 'Vapor Shop Central',
    address: null,
    phone: null,
    logo_base64: null,
    show_logo_on_receipt: 1,
    currency_code: 'PKR',
    currency_decimals: 0,
    receipt_footer: 'Thank you',
    default_low_stock_threshold: 3,
    created_at: '2026-11-15T12:00:00.000Z',
    updated_at: '2026-11-15T12:00:00.000Z',
    deleted_at: null,
    device_id: uuidv7(),
    dirty: 0,
    server_updated_at: null,
  };
  shopRow.shop_id = shopRow.id;
  const lowRow: { variant_id: string; on_hand: number; threshold: number }[] = [
    { variant_id: uuidv7(), on_hand: 2, threshold: 3 },
  ];
  state.values = { pin_hash: '', idle_lock_minutes: '0' };
  state.db.query
    .mockReset()
    .mockImplementation(async (sql: string) => {
      if (sql.includes('FROM settings')) {
        return Object.entries(state.values).map(([key, value]) => ({ key, value }));
      }
      if (sql.includes('FROM shops')) return [shopRow];
      if (sql.includes('COALESCE(sm.on_hand, 0) <= COALESCE(v.low_stock_threshold')) return lowRow;
      return [];
    });
  await mountShell();
  const json = () => JSON.stringify(renderer!.toJSON());
  expect(json()).toContain('low stock');

  lowRow.length = 0;
  await act(async () => {
    notifyStockChanged();
  });
  expect(json()).not.toContain('low stock');
});
it('applies PIN enabling and idle changes immediately and removes an open drawer on lock', async () => {
  state.values = { pin_hash: '', idle_lock_minutes: '0' };
  await mountShell();
  expect(JSON.stringify(renderer!.toJSON())).toContain('Shop settings content');
  const more = renderer!.root
    .findAllByType('button')
    .find((button) => button.findAllByType('span').some((span) => span.props.children === 'More'))!;
  act(() => more.props.onClick());
  state.values = { pin_hash: 'configured', idle_lock_minutes: '1' };
  await act(async () => {
    window.dispatchEvent(new Event('vaporflow-security-changed'));
  });
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('VaporFlow Locked');
  expect(renderer!.root.findAllByType('a')).toHaveLength(0);
});
it('shows a retry screen instead of setup when the shop query fails', async () => {
  state.db.query.mockRejectedValue(new Error('database read failed'));
  await act(async () => {
    renderer = create(<App />);
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Could not read shop configuration');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('First run wizard');
  state.db.query.mockResolvedValue([]);
  await act(async () => {
    renderer!.root.findByType('button').props.onClick();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('First run wizard');
});

it('keeps the picked quantity when Android Back closes checkout and filters the grid by category', async () => {
  const shopId = uuidv7();
  const categoryId = uuidv7();
  const productId = uuidv7();
  const variantId = uuidv7();
  const row = {
    id: shopId, shop_id: shopId, device_id: uuidv7(), created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), deleted_at: null, server_updated_at: null, dirty: 0,
  };
  state.db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM settings')) return Object.entries(state.values).filter(([key]) => !params.length || key === params[0]).map(([key, value]) => ({ key, value }));
    if (sql.includes('FROM shops')) return [{ ...row, name: 'Shop', address: null, phone: null,
      logo_base64: null, show_logo_on_receipt: 0, receipt_footer: '', default_low_stock_threshold: 2 }];
    if (sql.startsWith('SELECT * FROM categories')) return [
      { ...row, id: categoryId, name: 'Cables', sort_order: 1 },
      { ...row, id: uuidv7(), name: 'Adapters', sort_order: 2 },
    ];
    if (sql.startsWith('SELECT * FROM products')) return [
      { ...row, id: productId, name: 'Cable', category_id: categoryId, brand: null, notes: null, is_active: 1 },
    ];
    if (sql.startsWith('SELECT * FROM variants')) return [
      { ...row, id: variantId, name: 'USB', product_id: productId, cost_price: 100, sale_price: 250,
        sku: null, barcode: null, low_stock_threshold: null, track_stock: 1, is_active: 1 },
    ];
    return [];
  });
  state.values = { pin_hash: '', idle_lock_minutes: '1' };
  await mountShell('/');
  const root = renderer!.root;
  const card = () => root.findAllByProps({ className: 'pick-card' });
  act(() => card()[0]!.props.onClick());
  act(() => root.findByProps({ className: 'cart-dock' }).props.onClick());
  expect(root.findAllByType('dialog')).toHaveLength(1);
  act(() => { expect(handleBackThroughDialogs()).toBe(true); });
  expect(root.findAllByType('dialog')).toHaveLength(0);
  expect(root.findByProps({ className: 'pick-qty' }).children).toEqual(['1']);
  act(() => root.findAllByType('button').find(b => b.children.includes('Adapters'))!.props.onClick());
  expect(card()).toHaveLength(0);
  act(() => root.findAllByType('button').find(b => b.children.includes('Cables'))!.props.onClick());
  expect(card()).toHaveLength(1);
  state.values.pin_hash = 'configured';
  await act(async () => { window.dispatchEvent(new Event('vaporflow-security-changed')); });
  act(() => { vi.advanceTimersByTime(60000); });
  expect(card()).toHaveLength(0);
  await act(async () => root.findByType(LockScreen).props.onUnlock());
  expect(root.findByProps({ className: 'pick-qty' }).children).toEqual(['1']);
});
it.each([
  ['/reports', 'Reports', 'Reports content'],
  ['/settings', 'Settings', 'Shop settings content'],
])('requires the PIN before opening %s', async (path, section, content) => {
  state.values = { pin_hash: await hashPin('1234'), idle_lock_minutes: '1' };
  await mountShell(path);
  await act(async () => {
    renderer!.root.findByType(LockScreen).props.onUnlock();
  });
  const json = () => JSON.stringify(renderer!.toJSON());
  expect(json()).toContain(`PIN required for ${section}`);
  expect(json()).not.toContain(content);

  await enterPin();
  expect(json()).toContain(content);
});
it('requires the PIN before a return is initiated', async () => {
  const iso = '2026-11-20T12:00:00.000Z';
  const shopId = uuidv7();
  const deviceId = uuidv7();
  const saleId = uuidv7();
  const saleItemId = uuidv7();
  const variantId = uuidv7();
  const base = {
    shop_id: shopId, device_id: deviceId, created_at: iso, updated_at: iso,
    deleted_at: null, dirty: 0, server_updated_at: null,
  };
  const shop = {
    ...base, id: shopId, name: 'Vapor Shop', address: null, phone: null,
    logo_base64: null, show_logo_on_receipt: 0, currency_code: 'PKR',
    currency_decimals: 0, receipt_footer: 'Thank you', default_low_stock_threshold: 2,
  };
  const sale = {
    ...base, id: saleId, receipt_no: 'PC1-000001', sold_at: iso, subtotal: 250,
    discount_amount: 0, total: 250, payment_method: 'cash', amount_received: 250, note: null,
  };
  const saleItem = {
    ...base, id: saleItemId, sale_id: saleId, variant_id: variantId,
    product_name: 'USB Cable', variant_name: 'Default', qty: 1, list_price: 250,
    unit_price: 250, unit_cost: 100, net_total: 250,
  };
  shop.shop_id = shopId;

  state.values = { pin_hash: await hashPin('1234'), idle_lock_minutes: '1' };
  state.db.query.mockReset().mockImplementation(
    async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM settings')) {
        const rows = Object.entries(state.values).map(([key, value]) => ({ key, value }));
        return sql.includes('WHERE key =')
          ? rows.filter((row) => row.key === params[0])
          : rows;
      }
      if (sql.includes('FROM shops')) return [shop];
      if (sql.includes('FROM sales')) return [sale];
      if (sql.includes('FROM sale_items')) return [saleItem];
      return [];
    },
  );

  await mountShell('/sales');
  await act(async () => {
    renderer!.root.findByType(LockScreen).props.onUnlock();
  });
  await act(async () => {
    renderer!.root.findByProps({ className: 'receipt-row' }).props.onClick();
  });
  const processReturn = renderer!.root
    .findAllByType('button')
    .find((button) => button.children.includes('Process return'))!;
  act(() => processReturn.props.onClick());

  const json = () => JSON.stringify(renderer!.toJSON());
  expect(json()).toContain('PIN required for return');
  expect(json()).not.toContain('Confirm Return');

  await enterPin();
  expect(json()).toContain('Confirm Return');
});
