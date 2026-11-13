/**
 * Recognise "that part of the schema is not there yet" errors.
 *
 * The account features add tables and columns in numbered migrations that are
 * applied by hand. Until one is applied, a feature must keep working without it
 * rather than fail, so the server asks for the new thing and, if the database says
 * it does not exist, carries on. Codes come from Postgres (42xxx) and from
 * PostgREST (PGRSTxxx), the HTTP layer Supabase puts in front of it.
 */
export interface DbError {
  code?: string;
  message?: string;
}

export function isMissingTable(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /could not find the table|relation .* does not exist/i.test(error.message ?? '')
  );
}

export function isMissingColumn(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist|could not find the '.*' column/i.test(error.message ?? '')
  );
}
