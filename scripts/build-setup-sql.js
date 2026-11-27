// Schema version is the number of entries in the ordered migration manifest.
// Timestamp IDs are intentionally sparse. Missing manifest entries constitute gaps.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { MIGRATION_FILES } from '../packages/core/src/cloud-migrations.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
export function buildSetupSql(directory = path.join(root, 'supabase/migrations')) {
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No SQL migrations found');
  if (JSON.stringify(files) !== JSON.stringify(MIGRATION_FILES)) {
    throw new Error('Migration gap or unregistered migration: check the ordered manifest');
  }
  return [
    '-- schema_version: ' + files.length,
    '-- Generated file. Do not edit by hand. Generated ' + new Date().toISOString(),
    '-- New project: run the entire file once. Existing project: run only unapplied sections in order.',
    ...files.map(file => '-- Migration: ' + file + '\n' + readFileSync(path.join(directory, file), 'utf8')),
  ].join('\n\n') + '\n';
}

export function generateSetupSql() {
  const sql = buildSetupSql();
  mkdirSync(path.join(root, 'dist-sql'), { recursive: true });
  writeFileSync(path.join(root, 'dist-sql/setup.sql'), sql);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) generateSetupSql();
