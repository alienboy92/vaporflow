import { expect, it } from 'vitest';
import { IdleLock } from './idle-lock';
import { ErrorLogger } from './logger';
it('locks at the idle deadline and does not accept overdue resume activity', () => {
  let now = 0;
  const clock = new IdleLock(() => now);
  now = 59000;
  expect(clock.activity(1)).toBe(false);
  now = 119000;
  expect(clock.activity(1)).toBe(true);
  expect(clock.expired(1)).toBe(true);
  clock.reset();
  expect(clock.expired(1)).toBe(false);
  now += 900000;
  expect(clock.expired(0)).toBe(false);
});
it('never retains arbitrary error payloads or secret-bearing stack messages', () => {
  const logger = new ErrorLogger();
  const error = new Error('pin=1234 password=secret {"access_token":"token"}');
  error.stack = error.message + '\n at fn (https://localhost/assets/main.js:10:2)';
  logger.log(error);
  const output = JSON.stringify(logger.getLogs());
  for (const secret of ['1234', 'secret', 'access_token']) expect(output).not.toContain(secret);
  expect(output).toContain('main.js:10:2');
  for (let i = 0; i < 110; i++) logger.log({ sensitivePayload: i });
  expect(logger.getLogs()).toHaveLength(100);
  logger.clear();
  expect(logger.getLogs()).toEqual([]);
});
