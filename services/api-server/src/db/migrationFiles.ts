import { readdir } from 'node:fs/promises';

/**
 * Numbered migrations that run after the baseline `migrations.sql`.
 *
 *   NNN_snake_case_name.sql
 *
 * Each developer owns a number range so two people never fight over a file name
 * or an ordering:  010-019 account · 020-029 products · 030-039 inventory.
 * Every file must be safe to run twice (see migrations.test.ts).
 */
export const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Only well-named files, in numeric order (ties broken by name). */
export function sortMigrationNames(names: string[]): string[] {
  return names
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((a, b) => {
      const byNumber = Number(a.slice(0, 3)) - Number(b.slice(0, 3));
      return byNumber !== 0 ? byNumber : a.localeCompare(b);
    });
}

export async function listMigrationFiles(dir: URL | string): Promise<string[]> {
  return sortMigrationNames(await readdir(dir));
}
