import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATION_FILES } from './cloud-migrations.js';
import { EXPECTED_SCHEMA_VERSION, schemaWarning } from './cloud-schema.js';

function generate(directory?: string) {
  return execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {buildSetupSql} from './scripts/build-setup-sql.js'; process.stdout.write(buildSetupSql(process.argv[1]))",
    ...(directory ? [directory] : [])], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
}
describe('cloud setup SQL', () => {
  it('matches the client version, seed and migration order', () => {
    const sql = generate();
    expect(sql.split('\n')[0]).toBe('-- schema_version: ' + EXPECTED_SCHEMA_VERSION);
    expect(sql).toContain("VALUES ('schema_version', '" + EXPECTED_SCHEMA_VERSION + "')");
    expect([...sql.matchAll(/^-- Migration: (.+)$/gm)].map(match => match[1]?.trim())).toEqual(MIGRATION_FILES);
  });
  it('rejects empty and incomplete migration directories', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'setup-sql-'));
    try {
      expect(() => generate(directory)).toThrow(/No SQL migrations/);
      for (const name of MIGRATION_FILES.filter((_, index) => index !== 1)) writeFileSync(path.join(directory, name), '');
      expect(() => generate(directory)).toThrow(/Migration gap/);
    } finally { rmSync(directory, { force: true, recursive: true }); }
  });
  it.each([
    [String(EXPECTED_SCHEMA_VERSION), null],
    [String(EXPECTED_SCHEMA_VERSION - 1), 'Cloud database is outdated. Re-run the setup SQL.'],
    [String(EXPECTED_SCHEMA_VERSION + 1), 'App is outdated, please update.'],
    [null, 'Cloud database is outdated. Re-run the setup SQL.'],
  ])('compares cloud version %s', (value, warning) => {
    expect(schemaWarning(value === null ? null : { value })).toBe(warning);
  });
});
