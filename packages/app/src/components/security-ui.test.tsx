import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { Shell } from './Shell';
import { App } from '../App';
import { notifyStockChanged } from '../utils/stock-events';
import { uuidv7 } from '@vaporflow/core';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ db: { query: vi.fn() }, values: {} as Record<string, string> }));
vi.mock('../context/DbProvider', () => ({
  useDb: () => state.db,
  usePlatform: () => ({
    network: { isOnline: () => true, onChange: () => () => {} },
  }),
  DbProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../screens/SettingsScreen', () => ({
  SettingsScreen: () => <div>Shop settings content</div>,
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
async function mountShell() {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={['/settings']}>
        <Shell />
      </MemoryRouter>,
    );
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
