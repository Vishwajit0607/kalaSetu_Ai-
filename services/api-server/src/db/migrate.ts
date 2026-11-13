import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Applies migrations.sql against the Supabase Postgres instance.
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
  const sql = await readFile(join(here, 'migrations.sql'), 'utf8');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✓ migrations applied');
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
