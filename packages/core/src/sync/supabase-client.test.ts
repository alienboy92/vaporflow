import { expect, it } from 'vitest';
import { projectUrl, publicClientKey } from './supabase-client.js';

it.each(['', '/', '/rest/v1', '/rest/v1/'])('accepts a copied project endpoint ending in %s', suffix => {
  expect(projectUrl(' https://example.supabase.co' + suffix + ' ')).toBe('https://example.supabase.co');
});

it('preserves a reverse proxy base path', () => {
  expect(projectUrl('https://example.org/shop/rest/v1/')).toBe('https://example.org/shop');
});

it('accepts only publishable and legacy anon credentials', () => {
  const token = (role: string) => 'header.' + btoa(JSON.stringify({ role })).replace(/=+$/, '') + '.signature';
  expect(publicClientKey(token('anon'))).toBe(token('anon'));
  expect(publicClientKey('sb_publishable_example')).toBe('sb_publishable_example');
  for (const key of [token('service_role'), token('authenticated'), 'sb_secret_example', 'broken']) {
    expect(() => publicClientKey(key)).toThrow(/publishable/);
  }
});
