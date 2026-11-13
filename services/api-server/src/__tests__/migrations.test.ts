import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MIGRATION_FILE, listMigrationFiles, sortMigrationNames } from '../db/migrationFiles.js';

const FOLDER = new URL('../db/migrations/', import.meta.url);

describe('sortMigrationNames', () => {
  it('orders by number, not alphabetically', () => {
    expect(sortMigrationNames(['100_c.sql', '020_b.sql', '010_a.sql'])).toEqual([
      '010_a.sql',
      '020_b.sql',
      '100_c.sql',
    ]);
  });

  it('ignores files that do not follow the naming rule', () => {
    expect(
      sortMigrationNames(['README.md', '30_short.sql', '030_Bad-Name.sql', '030_ok.sql', 'notes.txt']),
    ).toEqual(['030_ok.sql']);
  });

  it('breaks ties on the same number by name', () => {
    expect(sortMigrationNames(['030_b.sql', '030_a.sql'])).toEqual(['030_a.sql', '030_b.sql']);
  });
});

describe('the real migrations folder', () => {
  it('has no file that looks like a migration but breaks the naming rule', async () => {
    const { readdir } = await import('node:fs/promises');
    const sqlFiles = (await readdir(FOLDER)).filter((name) => name.endsWith('.sql'));
    for (const name of sqlFiles) expect(name).toMatch(MIGRATION_FILE);
  });

  it('never reuses a number inside one developer range by accident', async () => {
    const names = await listMigrationFiles(FOLDER);
    const numbers = names.map((name) => name.slice(0, 3));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('is safe to run twice and never destructive', async () => {
    for (const name of await listMigrationFiles(FOLDER)) {
      // Strip comments so a warning in a comment does not trip the check.
      const sql = (await readFile(new URL(name, FOLDER), 'utf8')).replace(/--.*$/gm, '');

      expect(sql, `${name}: destructive statement`).not.toMatch(/\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
      expect(sql, `${name}: plain CREATE TABLE`).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(sql, `${name}: plain CREATE INDEX`).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(sql, `${name}: plain CREATE VIEW`).not.toMatch(/CREATE\s+VIEW\b/i);
      expect(sql, `${name}: plain CREATE FUNCTION`).not.toMatch(/CREATE\s+FUNCTION\b/i);
    }
  });
});
