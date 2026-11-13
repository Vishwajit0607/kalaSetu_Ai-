import { getArtisan } from './auth.service.js';
import { maskIp } from './audit.service.js';
import { isMissingColumn, isMissingTable } from './missingSchema.js';
import { supabase } from './supabase.service.js';
import type { Artisan } from '../types/index.js';

/**
 * "Download my data": everything the system holds about one artisan, as one JSON
 * document. People are entitled to see what is stored about them, and an artisan
 * moving to another tool should be able to take their catalog with them.
 *
 * Only ever the caller's own rows. Each table is capped, and a table that hit its
 * cap says so (`truncated`) rather than silently handing over a partial copy as if
 * it were the whole. A table that does not exist yet (its migration has not been
 * applied) exports as empty.
 */

export const EXPORT_ROW_CAP = 5000;

export interface DataExport {
  exported_at: string;
  artisan: Artisan;
  products: unknown[];
  stock_movements: unknown[];
  inquiries_received: unknown[];
  inquiries_sent: unknown[];
  security_events: unknown[];
  /** Names of any lists that were cut at EXPORT_ROW_CAP. */
  truncated: string[];
  counts: Record<string, number>;
}

interface Slice {
  rows: unknown[];
  truncated: boolean;
}

/** One table's rows for this artisan, capped, empty if the table or column is not there yet. */
async function fetchRows(
  table: string,
  select: string,
  column: string,
  artisanId: string,
  orderBy: string,
): Promise<Slice> {
  const { data, error } = await supabase()
    .from(table)
    .select(select)
    .eq(column, artisanId)
    .order(orderBy, { ascending: false })
    .limit(EXPORT_ROW_CAP + 1);

  if (error) {
    if (isMissingTable(error) || isMissingColumn(error)) return { rows: [], truncated: false };
    throw new Error(`export of ${table} failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown[];
  return { rows: rows.slice(0, EXPORT_ROW_CAP), truncated: rows.length > EXPORT_ROW_CAP };
}

/** Returns null if the account no longer exists. */
export async function buildDataExport(artisanId: string, now = new Date()): Promise<DataExport | null> {
  const artisan = await getArtisan(artisanId);
  if (!artisan) return null;

  // One after another, not in parallel: this is a rare, heavy request and it keeps
  // peak memory to one table at a time.
  const products = await fetchRows('products', '*', 'artisan_id', artisanId, 'updated_at');
  const movements = await fetchRows('stock_movements', '*', 'artisan_id', artisanId, 'created_at');
  const received = await fetchRows('buyer_inquiries', '*', 'artisan_id', artisanId, 'created_at');
  const sent = await fetchRows('buyer_inquiries', '*', 'buyer_artisan_id', artisanId, 'created_at');
  const events = await fetchRows('auth_events', 'id, event_type, ip, user_agent, created_at', 'artisan_id', artisanId, 'created_at');

  const security = events.rows.map((row) => ({ ...(row as { ip: string | null }), ip: maskIp((row as { ip: string | null }).ip) }));

  const slices: Record<string, Slice> = {
    products,
    stock_movements: movements,
    inquiries_received: received,
    inquiries_sent: sent,
    security_events: { rows: security, truncated: events.truncated },
  };

  return {
    exported_at: now.toISOString(),
    artisan,
    products: products.rows,
    stock_movements: movements.rows,
    inquiries_received: received.rows,
    inquiries_sent: sent.rows,
    security_events: security,
    truncated: Object.entries(slices).filter(([, slice]) => slice.truncated).map(([name]) => name),
    counts: Object.fromEntries(Object.entries(slices).map(([name, slice]) => [name, slice.rows.length])),
  };
}
