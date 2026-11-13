import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

import { clip, eventContext, listAuthEvents, maskIp, recordAuthEvent } from '../services/audit.service.js';

const ARTISAN = 'aaaaaaaa-0000-0000-0000-000000000001';

beforeEach(() => db.reset());

describe('maskIp', () => {
  it('hides the last part of an IPv4 address', () => {
    expect(maskIp('203.0.113.9')).toBe('203.0.113.x');
  });

  it('hides the second half of an IPv6 address', () => {
    expect(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:8d3:x:x:x:x');
  });

  it('returns null for nothing or for something that is not an address', () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('not-an-ip')).toBeNull();
  });
});

describe('clip and eventContext', () => {
  it('cuts a value to the column width and treats empty as null', () => {
    expect(clip('abcdef', 3)).toBe('abc');
    expect(clip('', 3)).toBeNull();
    expect(clip(undefined, 3)).toBeNull();
  });

  it('reads the caller\'s address and a length-capped user agent from the request', () => {
    const ctx = eventContext({ ip: '203.0.113.9', headers: { 'user-agent': 'x'.repeat(500) } });
    expect(ctx.ip).toBe('203.0.113.9');
    expect(ctx.userAgent).toHaveLength(200);
  });

  it('copes with a missing or repeated user-agent header', () => {
    expect(eventContext({ ip: '1.2.3.4', headers: {} }).userAgent).toBeNull();
    expect(eventContext({ ip: '1.2.3.4', headers: { 'user-agent': ['a', 'b'] as never } }).userAgent).toBe('a');
  });
});

describe('recordAuthEvent', () => {
  it('stores the event for the artisan, with where it came from', async () => {
    db.answer({ data: null });
    const stored = await recordAuthEvent(ARTISAN, 'login', { ip: '203.0.113.9', userAgent: 'okhttp/4' });

    expect(stored).toBe(true);
    expect(db.argsOf('from')).toEqual(['auth_events']);
    expect(db.argsOf('insert')).toEqual([{ artisan_id: ARTISAN, event_type: 'login', ip: '203.0.113.9', user_agent: 'okhttp/4' }]);
  });

  it('never throws, so a failed audit write cannot break the login it records', async () => {
    db.answer({ error: { code: '08006', message: 'connection failure' } });
    await expect(recordAuthEvent(ARTISAN, 'login')).resolves.toBe(false);
  });

  it('reports false, quietly, before migration 010 has created the table', async () => {
    db.answer({ error: { code: '42P01', message: 'relation "auth_events" does not exist' } });
    await expect(recordAuthEvent(ARTISAN, 'signup')).resolves.toBe(false);
  });
});

describe('listAuthEvents', () => {
  const event = (n: number) => ({ id: `e${n}`, event_type: 'login', ip: '203.0.113.9', user_agent: 'ua', created_at: `2026-11-1${n}T10:00:00.000Z` });

  it('returns the caller\'s events newest first, with the address masked', async () => {
    db.answer({ data: [event(3), event(2)] });
    const page = await listAuthEvents(ARTISAN, { limit: 10 });

    expect(page.events.map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(page.events[0]!.ip).toBe('203.0.113.x');
    expect(page.next_before).toBeNull();
    expect(db.allOf('eq')).toContainEqual(['artisan_id', ARTISAN]);
    expect(db.argsOf('order')).toEqual(['created_at', { ascending: false }]);
  });

  it('asks for one extra row and gives a cursor when there is a next page', async () => {
    db.answer({ data: [event(3), event(2), event(1)] });
    const page = await listAuthEvents(ARTISAN, { limit: 2 });

    expect(db.argsOf('limit')).toEqual([3]);
    expect(page.events).toHaveLength(2);
    expect(page.next_before).toBe(event(2).created_at);
  });

  it('continues from a cursor', async () => {
    db.answer({ data: [] });
    await listAuthEvents(ARTISAN, { limit: 5, before: '2026-11-12T10:00:00.000Z' });
    expect(db.argsOf('lt')).toEqual(['created_at', '2026-11-12T10:00:00.000Z']);
  });

  it('is an empty list, not an error, before migration 010', async () => {
    db.answer({ error: { code: 'PGRST205', message: 'Could not find the table public.auth_events' } });
    await expect(listAuthEvents(ARTISAN, { limit: 5 })).resolves.toEqual({ events: [], next_before: null });
  });

  it('does not hide an unrelated failure', async () => {
    db.answer({ error: { code: '08006', message: 'connection failure' } });
    await expect(listAuthEvents(ARTISAN, { limit: 5 })).rejects.toThrow(/connection failure/);
  });
});
