import { expect, it } from 'vitest';
import { assertSender, validateBatch, validateQuery } from './ipc-policy.js';

it('accepts only the expected main frame and window', () => {
  const expected = { webContentsId: 1, url: 'file:///app/index.html' };
  const valid = { ...expected, isMainFrame: true };
  expect(() => assertSender({ ...valid, url: expected.url + '#settings' }, expected)).not.toThrow();
  for (const invalid of [
    { ...valid, isMainFrame: false },
    { ...valid, webContentsId: 2 },
    { ...valid, url: 'https://evil.example' },
  ]) {
    expect(() => assertSender(invalid, expected)).toThrow('Untrusted');
  }
});
it('rejects malformed SQL payloads and unsupported parameter values', () => {
  expect(validateQuery('SELECT ?', [null]).params).toEqual([null]);
  for (const params of [[{}], [undefined], [Infinity], 'string'])
    expect(() => validateQuery('SELECT ?', params)).toThrow();
  expect(() => validateBatch([{ sql: '' }])).toThrow();
  expect(() => validateBatch([{ sql: 'SELECT 1', extra: true }])).toThrow();
});
