import { BatchSchema, StatementSchema } from '@vaporflow/core';

export function assertSender(
  actual: { webContentsId: number; isMainFrame: boolean; url: string },
  expected: { webContentsId: number; url: string },
): void {
  const withoutHash = (url: string) => url.split('#')[0];
  if (
    actual.webContentsId !== expected.webContentsId ||
    !actual.isMainFrame ||
    withoutHash(actual.url) !== withoutHash(expected.url)
  ) {
    throw new Error('Untrusted IPC sender');
  }
}
export function validateQuery(sql: unknown, params: unknown) {
  return StatementSchema.parse({ sql, params });
}
export function validateBatch(statements: unknown) {
  return BatchSchema.parse(statements);
}
