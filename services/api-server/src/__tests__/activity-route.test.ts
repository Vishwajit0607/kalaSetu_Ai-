import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => db.reset());

const event = (n: number, ip = '203.0.113.9') => ({
  id: `e${n}`,
  event_type: 'login',
  ip,
  user_agent: 'okhttp/4',
  created_at: `2026-11-1${n}T10:00:00.000Z`,
});

describe('GET /v1/me/activity', () => {
  it('returns the caller\'s own events, newest first, with addresses masked', async () => {
    db.answer({ data: [event(3), event(2)] });
    const res = await call('GET', '/v1/me/activity');

    expect(res.statusCode).toBe(200);
    expect(res.json().events.map((e: { id: string }) => e.id)).toEqual(['e3', 'e2']);
    expect(res.json().events[0].ip).toBe('203.0.113.x'); // the full address never leaves the server
    expect(res.json().next_before).toBeNull();
  });

  it('only ever reads the token\'s artisan, whoever the query names', async () => {
    db.answer({ data: [] });
    await call('GET', `/v1/me/activity?artisan_id=${OTHER}`, { as: ME });
    expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
    expect(db.allOf('eq')).not.toContainEqual(['artisan_id', OTHER]);

    db.reset();
    db.answer({ data: [] });
    await call('GET', `/v1/me/activity?artisan_id=${ME}`, { as: OTHER });
    expect(db.allOf('eq')).toContainEqual(['artisan_id', OTHER]);
  });

  it('pages: a default of 20, a cursor when there is more, and continues from a cursor', async () => {
    db.answer({ data: [event(3), event(2), event(1)] });
    const res = await call('GET', '/v1/me/activity?limit=2');
    expect(db.argsOf('limit')).toEqual([3]);
    expect(res.json().events).toHaveLength(2);
    expect(res.json().next_before).toBe(event(2).created_at);

    db.reset();
    db.answer({ data: [] });
    await call('GET', '/v1/me/activity');
    expect(db.argsOf('limit')).toEqual([21]);

    db.reset();
    db.answer({ data: [] });
    await call('GET', '/v1/me/activity?before=2026-11-12T10:00:00.000Z');
    expect(db.argsOf('lt')).toEqual(['created_at', '2026-11-12T10:00:00.000Z']);
  });

  it('is an empty list, not an error, before migration 010 has created the table', async () => {
    db.answer({ error: { code: '42P01', message: 'relation "auth_events" does not exist' } });
    const res = await call('GET', '/v1/me/activity');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], next_before: null });
  });

  it('rejects a bad limit or cursor, and requires a token', async () => {
    for (const q of ['limit=0', 'limit=51', 'limit=abc', 'before=yesterday']) {
      expect((await call('GET', `/v1/me/activity?${q}`)).statusCode).toBe(400);
    }
    expect((await call('GET', '/v1/me/activity', { as: null })).statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
