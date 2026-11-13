import type { FastifyRequest } from 'fastify';
import { normalizePhone } from './auth.service.js';
import { supabase } from './supabase.service.js';

/**
 * The account security trail: signup, login, failed login, logout, password
 * change. Written by the server only (see migration 011), read back by the
 * artisan on their Activity screen.
 *
 * Two rules shape this file:
 *   1. Recording an event must NEVER break the action it records. A login that
 *      succeeded must not fail because the audit table was unreachable, so
 *      `recordAuthEvent` swallows its own errors and reports success as a boolean.
 *   2. The feature must work before migration 010 is applied (the table does not
 *      exist yet): recording is skipped and the list is empty, quietly.
 */

export type AuthEventType = 'signup' | 'login' | 'login_failed' | 'logout' | 'password_changed';

export interface AuthEventContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthEventRow {
  id: string;
  event_type: AuthEventType;
  /** Masked for display: see `maskIp`. */
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

const MAX_IP = 45; // an IPv6 address
const MAX_USER_AGENT = 200;

/** Trim to the column width so one odd header cannot make an insert fail. */
export function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.slice(0, max);
}

/** Where the request came from, in the shape the table stores. */
export function eventContext(request: Pick<FastifyRequest, 'ip' | 'headers'>): AuthEventContext {
  const agent = request.headers['user-agent'];
  return {
    ip: clip(request.ip, MAX_IP),
    userAgent: clip(Array.isArray(agent) ? agent[0] : agent, MAX_USER_AGENT),
  };
}

/**
 * "203.0.113.9" -> "203.0.113.x"; "2001:db8:85a3:8d3:1319:8a2e:370:7348" ->
 * "2001:db8:85a3:8d3:x:x:x:x". Enough to answer "was that my usual network?" without
 * handing the full address to anyone who sees the screen.
 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(':')) {
    const groups = ip.split(':');
    return groups.length > 4 ? [...groups.slice(0, 4), 'x', 'x', 'x', 'x'].join(':') : ip;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : null;
}

/** The migration has not been applied if the table is not there. */
function tableMissing(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message ?? '');
}

/** Record one event. Never throws; returns whether a row was stored. */
export async function recordAuthEvent(
  artisanId: string,
  type: AuthEventType,
  context: AuthEventContext = {},
): Promise<boolean> {
  try {
    const { error } = await supabase()
      .from('auth_events')
      .insert({
        artisan_id: artisanId,
        event_type: type,
        ip: clip(context.ip, MAX_IP),
        user_agent: clip(context.userAgent, MAX_USER_AGENT),
      });
    return !error;
  } catch {
    return false;
  }
}

export interface ActivityPage {
  events: AuthEventRow[];
  /** Pass back as `before` for the next (older) page; null when there is none. */
  next_before: string | null;
}

export async function listAuthEvents(
  artisanId: string,
  options: { limit: number; before?: string },
): Promise<ActivityPage> {
  let builder = supabase()
    .from('auth_events')
    .select('id, event_type, ip, user_agent, created_at')
    .eq('artisan_id', artisanId);
  if (options.before) builder = builder.lt('created_at', options.before);

  // One extra row tells us whether another page exists.
  const { data, error } = await builder
    .order('created_at', { ascending: false })
    .limit(options.limit + 1);

  if (error) {
    if (tableMissing(error)) return { events: [], next_before: null };
    throw new Error(`activity lookup failed: ${error.message}`);
  }

  const rows = (data ?? []) as AuthEventRow[];
  const page = rows.slice(0, options.limit).map((row) => ({ ...row, ip: maskIp(row.ip) }));
  return {
    events: page,
    next_before: rows.length > options.limit ? (page.at(-1)?.created_at ?? null) : null,
  };
}

/**
 * A login with the wrong password: record it against the account, if there is one.
 *
 * Callers must NOT await this. The login endpoint answers identically for "no such
 * number" and "wrong password" so nobody can probe which numbers have accounts;
 * awaiting an extra lookup and insert only in the second case would put that
 * difference back, in the response time. It never throws.
 */
export async function noteFailedLogin(phone: string, context: AuthEventContext = {}): Promise<void> {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    const { data } = await supabase()
      .from('artisans')
      .select('id')
      .eq('phone_number', normalized)
      .maybeSingle();

    const id = (data as { id?: string } | null)?.id;
    if (id) await recordAuthEvent(id, 'login_failed', context);
  } catch {
    // Auditing is best effort.
  }
}
