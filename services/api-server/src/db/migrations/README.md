# Numbered migrations

These run **after** the baseline `../migrations.sql`, in numeric order.

| Range | Owner | Module |
| --- | --- | --- |
| 010-019 | Developer 1 | Account, security and platform |
| 020-029 | Developer 2 | Product lifecycle and studio |
| 030-039 | Developer 3 | Inventory ledger, analytics and inquiries |

## Rules

1. File name: `NNN_snake_case_name.sql`.
2. **Safe to run twice.** Use `IF NOT EXISTS`, `CREATE OR REPLACE`, or
   `DROP ... IF EXISTS` first. `migrations.test.ts` enforces this.
3. **Never destructive.** No `DROP TABLE`, `TRUNCATE` or `DELETE FROM`.
4. Server code that depends on a migration must keep working when it has not been
   applied yet (see how `gallery_image_urls` is handled in `catalog.routes.ts`).

## Applying them

Supabase DDL cannot go through the REST API. Either:

- paste each file, in order, into **Supabase, SQL Editor**; or
- run `npm run db:migrate` with `DATABASE_URL` set (runs the baseline and then every
  numbered file in one transaction).
