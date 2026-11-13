import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { listMigrationFiles } from './migrationFiles.js';

/**
 * Applies migrations.sql and then every numbered file in ./migrations, in order,
 * in one transaction (all or nothing).
 * Needs a direct connection string (Supabase dashboard -> Database -> URI),
 * not the REST URL, because DDL cannot go through PostgREST.
 */
const connectionString = process.env.DATABASE_URL;

async function run(): Promise<void> {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required (postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres)',
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const folder = join(here, 'migrations');
  const files = ['migrations.sql', ...(await listMigrationFiles(folder)).map((name) => `migrations/${name}`)];

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      await client.query(await readFile(join(here, file), 'utf8'));
      console.log(`  applied ${file}`);
    }
    await client.query('COMMIT');
    console.log(`✓ ${files.length} migration file(s) applied`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error: unknown) => {
  console.error('✗ migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
