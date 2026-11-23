import { expect, it } from 'vitest';
import { localDate, reportRange } from './dates.js';

it('assigns late sales and both sides of PKT midnight to the shop day', () => {
  expect(localDate(new Date('2026-11-22T18:30:00Z'))).toBe('2026-11-22');
  expect(localDate(new Date('2026-11-22T19:00:00Z'))).toBe('2026-11-23');
  expect(reportRange('2026-11-22', '2026-11-22')).toEqual({
    startStr: '2026-11-21T19:00:00.000Z', endStr: '2026-11-22T18:59:59.999Z',
    dateOnlyStart: '2026-11-22', dateOnlyEnd: '2026-11-22',
  });
});
