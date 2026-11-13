import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const FOLDER = new URL('../db/migrations/', import.meta.url);
const NIKHIL_MIGRATIONS = ['030_stock_ledger.sql', '031_analytics_views.sql', '032_inquiry_status.sql'] as const;

/**
 * Strip SQL comments and GRANT/REVOKE lines so that a privilege-related
 * TRUNCATE keyword doesn't trip the destructive-statement lint.
 */
const strip = (sql: string) =>
  sql.replace(/--.*$/gm, '').replace(/\b(REVOKE|GRANT)\b[^;]*;/gi, '');

describe('migrations 030–032 (Nikhil Telkar – Inventory Ledger, Analytics, Inquiries)', () => {
  for (const name of NIKHIL_MIGRATIONS) {
    describe(name, () => {
      let sql: string;

      it('file exists and is readable', async () => {
        sql = await readFile(new URL(name, FOLDER), 'utf8');
        expect(sql.length).toBeGreaterThan(0);
      });

      it('contains no DROP TABLE, TRUNCATE, or DELETE FROM', async () => {
        sql ??= await readFile(new URL(name, FOLDER), 'utf8');
        const cleaned = strip(sql);
        expect(cleaned, `${name}: destructive statement`).not.toMatch(
          /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i,
        );
      });

      it('uses IF NOT EXISTS for CREATE TABLE', async () => {
        sql ??= await readFile(new URL(name, FOLDER), 'utf8');
        const cleaned = strip(sql);
        expect(cleaned, `${name}: plain CREATE TABLE`).not.toMatch(
          /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i,
        );
      });

      it('uses IF NOT EXISTS for CREATE INDEX', async () => {
        sql ??= await readFile(new URL(name, FOLDER), 'utf8');
        const cleaned = strip(sql);
        expect(cleaned, `${name}: plain CREATE INDEX`).not.toMatch(
          /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i,
        );
      });

      it('uses CREATE OR REPLACE for views', async () => {
        sql ??= await readFile(new URL(name, FOLDER), 'utf8');
        const cleaned = strip(sql);
        // Plain CREATE VIEW (without OR REPLACE) is not idempotent
        expect(cleaned, `${name}: plain CREATE VIEW`).not.toMatch(
          /CREATE\s+VIEW\b/i,
        );
      });

      it('uses CREATE OR REPLACE for functions', async () => {
        sql ??= await readFile(new URL(name, FOLDER), 'utf8');
        const cleaned = strip(sql);
        // Plain CREATE FUNCTION (without OR REPLACE) is not idempotent
        expect(cleaned, `${name}: plain CREATE FUNCTION`).not.toMatch(
          /CREATE\s+FUNCTION\b/i,
        );
      });
    });
  }

  it('the verify smoke-test SQL exists', async () => {
    const verifySQL = await readFile(
      new URL('verify/030_031_032_smoke.sql', FOLDER),
      'utf8',
    );
    expect(verifySQL).toContain('ALL CHECKS PASSED');
    // The smoke test must be safe: it ends with ROLLBACK
    expect(verifySQL.trimEnd()).toMatch(/ROLLBACK;\s*$/);
  });
});
