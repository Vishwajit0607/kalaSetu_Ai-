import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

/**
 * The whole account journey through the real routes: sign up, a wrong password, log
 * in, change the password, read the activity trail, export, log out.
 *
 * The database here is a tiny IN-MEMORY one (not scripted answers), so what is
 * checked is what a user would actually see: the events really land, in the right
 * order, and come back out through the activity screen and the export.
 */

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, clock: 0, revoked: [] as Array<[string, string]> }));

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private sortBy: [string, boolean] | null = null;
    private max = Infinity;
    private single = false;
    private inserted: Row | null = null;
    constructor(private table: string) {}
    select() { return this; }
    insert(row: Row) {
      // The database fills in the id and the time, so each event has its own.
      const stored = { id: `row-${(mem.tables[this.table] ??= []).length + 1}`, created_at: new Date(Date.UTC(2026, 10, 13, 10, 0, mem.clock++)).toISOString(), ...row };
      mem.tables[this.table]!.push(stored);
      this.inserted = stored;
      return this;
    }
    eq(column: string, value: unknown) { this.filters.push((r) => r[column] === value); return this; }
    lt(column: string, value: string) { this.filters.push((r) => String(r[column]) < value); return this; }
    order(column: string, options: { ascending: boolean }) { this.sortBy = [column, options.ascending]; return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      if (this.inserted) return Promise.resolve({ data: null, error: null as null }).then(resolve);
      let rows = (mem.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
      if (this.sortBy) {
        const [column, ascending] = this.sortBy;
        rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, this.max);
      return Promise.resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null as null }).then(resolve);
    }
  }

  return {
    ...original,
    supabase: () => ({
      from: (table: string) => new Query(table),
      auth: { admin: { signOut: async (token: string, scope: string) => { mem.revoked.push([token, scope]); return { error: null }; } } },
    }),
  };
});

// Credential checking itself is Supabase Auth's job and is tested elsewhere.
vi.mock('../services/auth.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/auth.service.js')>();
  const { AuthError } = original;
  const session = { access_token: 'a', refresh_token: 'r', expires_at: 9_999_999_999 };
  return {
    ...original,
    signUp: vi.fn(async () => ({ session, artisan: mem.tables.artisans![0] })),
    signIn: vi.fn(async ({ password }: { password: string }) => {
      if (password !== 'right-pass-1') throw new AuthError(401, 'invalid_credentials', 'Wrong phone number or password');
      return { session, artisan: mem.tables.artisans![0] };
    }),
    changePassword: vi.fn(async () => undefined),
  };
});

const PHONE = '9876543210';
const eventTypes = async () => (await call('GET', '/v1/me/activity')).json().events.map((e: { event_type: string }) => e.event_type);

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  mem.tables = { artisans: [{ id: ME, phone_number: '+91' + PHONE, full_name: 'Asha Verma', craft_category: 'Pottery' }] };
  mem.clock = 0;
  mem.revoked = [];
});

describe('an artisan\'s account journey', () => {
  it('leaves an accurate, ordered trail that the activity screen and the export both show', async () => {
    // 1. sign up
    expect((await call('POST', '/v1/auth/signup', { as: null, body: { phone: PHONE, password: 'right-pass-1', full_name: 'Asha Verma', craft_category: 'Pottery' } })).statusCode).toBe(201);
    await vi.waitFor(async () => expect(await eventTypes()).toEqual(['signup']));

    // 2. someone guesses the password
    expect((await call('POST', '/v1/auth/login', { as: null, body: { phone: PHONE, password: 'guess' } })).statusCode).toBe(401);
    await vi.waitFor(async () => expect(await eventTypes()).toEqual(['login_failed', 'signup']));

    // 3. the real owner logs in
    expect((await call('POST', '/v1/auth/login', { as: null, body: { phone: PHONE, password: 'right-pass-1' } })).statusCode).toBe(200);
    await vi.waitFor(async () => expect(await eventTypes()).toEqual(['login', 'login_failed', 'signup']));

    // 4. changes their password
    expect((await call('POST', '/v1/me/password', { body: { current_password: 'right-pass-1', new_password: 'brand-new-2' } })).statusCode).toBe(200);
    await vi.waitFor(async () => expect(await eventTypes()).toEqual(['password_changed', 'login', 'login_failed', 'signup']));

    // 5. the trail pages correctly
    const first = (await call('GET', '/v1/me/activity?limit=3')).json();
    expect(first.events.map((e: { event_type: string }) => e.event_type)).toEqual(['password_changed', 'login', 'login_failed']);
    expect(first.next_before).not.toBeNull();
    const second = (await call('GET', `/v1/me/activity?limit=3&before=${encodeURIComponent(first.next_before)}`)).json();
    expect(second.events.map((e: { event_type: string }) => e.event_type)).toEqual(['signup']);
    expect(second.next_before).toBeNull();

    // 6. the export contains the same trail
    const exported = (await call('GET', '/v1/me/export')).json();
    expect(exported.artisan.full_name).toBe('Asha Verma');
    expect(exported.counts.security_events).toBe(4);
    expect(exported.security_events.map((e: { event_type: string }) => e.event_type)).toEqual(['password_changed', 'login', 'login_failed', 'signup']);

    // 7. logs out: the session is really revoked, and the logout joins the trail
    expect((await call('POST', '/v1/auth/logout')).statusCode).toBe(204);
    expect(mem.revoked).toHaveLength(1);
    expect(mem.revoked[0]![1]).toBe('local');
    await vi.waitFor(async () => expect((await eventTypes())[0]).toBe('logout'));
  });

  it('does not record a failed login for a number that has no account', async () => {
    await call('POST', '/v1/auth/login', { as: null, body: { phone: '9123456780', password: 'guess' } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mem.tables.auth_events ?? []).toEqual([]);
  });

  it('shows an artisan only their own trail', async () => {
    (mem.tables.auth_events ??= []).push(
      { id: 'mine', artisan_id: ME, event_type: 'login', ip: null, user_agent: null, created_at: '2026-11-13T09:00:00.000Z' },
      { id: 'theirs', artisan_id: '99999999-8888-7777-6666-555555555555', event_type: 'login', ip: null, user_agent: null, created_at: '2026-11-13T09:30:00.000Z' },
    );
    const events = (await call('GET', '/v1/me/activity')).json().events;
    expect(events.map((e: { id: string }) => e.id)).toEqual(['mine']);
  });
});
