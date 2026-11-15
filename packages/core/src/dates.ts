import { DateSchema, TimestampSchema } from './types/schemas.js';
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function reportRange(
  start: string,
  end: string,
): { startStr: string; endStr: string; dateOnlyStart: string; dateOnlyEnd: string } {
  function boundary(value: string, last: boolean): Date {
    if (value.includes('T')) return new Date(TimestampSchema.parse(value));
    const [year, month, day] = DateSchema.parse(value).split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year!, month! - 1, day!);
    date.setHours(last ? 23 : 0, last ? 59 : 0, last ? 59 : 0, last ? 999 : 0);
    return date;
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
