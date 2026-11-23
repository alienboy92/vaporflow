import { create, act } from 'react-test-renderer';
import { it, expect, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';

vi.mock('../context/UpdateProvider', () => ({
  useUpdates: () => ({
    bannerVisible: true,
    info: { latestVersion: '1.0.1', currentVersion: '1.0.0' },
  }),
}));

it('defers an available update on the sale screen and shows it after leaving checkout', () => {
  const view = create(<UpdateBanner duringSale />);
  expect(view.toJSON()).toBeNull();
  act(() => view.update(<UpdateBanner duringSale={false} />));
  expect(view.root.findByProps({ role: 'status' })).toBeDefined();
  view.unmount();
});
