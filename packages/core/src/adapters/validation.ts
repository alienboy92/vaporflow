import { z } from 'zod';

export const SqlValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.null(),
  z.instanceof(Uint8Array),
]);
export const StatementSchema = z
  .object({
    sql: z.string().trim().min(1).max(2_000_000),
    params: z.array(SqlValueSchema).default([]),
  })
  .strict();
export const BatchSchema = z.array(StatementSchema).max(10000);
export const RowsSchema = z.array(z.record(z.string(), SqlValueSchema));
export type Statement = z.input<typeof StatementSchema>;

/** Queries used by repositories are single statements. WITH is used for read CTEs. */
export function returnsRows(sql: string): boolean {
  const start = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
  return (
    /^(SELECT|WITH|EXPLAIN)\b/i.test(start) ||
    /^PRAGMA\b[^=]*$/i.test(start.trim().replace(/;$/, ''))
  );
}
