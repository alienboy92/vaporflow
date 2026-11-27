import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function getSetupSql(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const file = app.isPackaged ? path.join(process.resourcesPath, 'setup.sql')
    : path.resolve(app.getAppPath(), '../../dist-sql/setup.sql');
  return readFile(file, 'utf8');
}
