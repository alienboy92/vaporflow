import { expect, it } from 'vitest';
import { projectUrl } from './supabase-client.js';

it.each(['', '/', '/rest/v1', '/rest/v1/'])('accepts a copied project endpoint ending in %s', suffix => {
  expect(projectUrl(' https://example.supabase.co' + suffix + ' ')).toBe('https://example.supabase.co');
});

it('preserves a reverse proxy base path', () => {
  expect(projectUrl('https://example.org/shop/rest/v1/')).toBe('https://example.org/shop');
});
