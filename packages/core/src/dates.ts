import { DateSchema, TimestampSchema } from './types/schemas.js';
export function localDate(date: Date): string {
  // Pakistan shop calendar (UTC+05:00 year round), independent of device settings.
  return new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 10);
}
export function reportRange(
  start: string,
  end: string,
): { startStr: string; endStr: string; dateOnlyStart: string; dateOnlyEnd: string } {
  function boundary(value: string, last: boolean): Date {
    if (value.includes('T')) return new Date(TimestampSchema.parse(value));
    const day = DateSchema.parse(value);
    return new Date(day + (last ? 'T23:59:59.999+05:00' : 'T00:00:00.000+05:00'));
  }
  const first = boundary(start, false),
    last = boundary(end, true);
  if (first > last) throw new Error('Start date must not follow end date');
  return {
    startStr: first.toISOString(),
    endStr: last.toISOString(),
    dateOnlyStart: localDate(first),
    dateOnlyEnd: localDate(last),
  };
}
