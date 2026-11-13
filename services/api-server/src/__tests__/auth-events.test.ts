import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

// The real sign-in talks to Supabase Auth; these tests are about what the routes
// record, so the credential check itself is stubbed.
vi.mock('../services/auth.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/auth.service.js')>();
  return { ...original, signIn: vi.fn(), signUp: vi.fn() };
});

import { AuthError, signIn, signUp } from '../services/auth.service.js';
import { call } from './helpers/authedApp.js';

const ARTISAN = 'aaaaaaaa-0000-0000-0000-000000000001';
const session = { access_token: 'a', refresh_token: 'r', expires_at: 9999999999 };

beforeEach(() => {
  db.reset();
  vi.mocked(signIn).mockReset();
  vi.mocked(signUp).mockReset();
});

const stored = (type: string) =>
  (db.allOf('insert') as Array<[Record<string, unknown>]>).find(([row]) => row.event_type === type)?.[0];

describe('login events', () => {
  it('records a successful login against that artisan, with the caller\'s address', async () => {
    vi.mocked(signIn).mockResolvedValue({ session, artisan: { id: ARTISAN } } as never);
    const res = await call('POST', '/v1/auth/login', { as: null, body: { phone: '9876543210', password: 'secret1' }, headers: { 'user-agent': 'okhttp/4' } });

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(stored('login')).toBeDefined());
    expect(stored('login')).toMatchObject({ artisan_id: ARTISAN, event_type: 'login', user_agent: 'okhttp/4' });
  });

  it('records a failed login against the account the number belongs to', async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError(401, 'invalid_credentials', 'nope'));
    db.answer({ data: { id: ARTISAN } }, { data: null });

    const res = await call('POST', '/v1/auth/login', { as: null, body: { phone: '9876543210', password: 'wrong' } });

    expect(res.statusCode).toBe(401);
    await vi.waitFor(() => expect(stored('login_failed')).toBeDefined());
    expect(stored('login_failed')).toMatchObject({ artisan_id: ARTISAN });
  });

  it('answers a wrong password and an unknown number with the same response', async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError(401, 'invalid_credentials', 'Wrong phone number or password'));

    db.answer({ data: { id: ARTISAN } }, { data: null }); // the number has an account
    const known = await call('POST', '/v1/auth/login', { as: null, body: { phone: '9876543210', password: 'x' } });
    db.reset();
    db.answer({ data: null }); // nobody has this number
    const unknown = await call('POST', '/v1/auth/login', { as: null, body: { phone: '9123456789', password: 'x' } });

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.json()).toEqual(unknown.json());
  });

  it('does not wait for the audit write before answering', async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError(401, 'invalid_credentials', 'nope'));
    // The audit lookup never answers. If the route awaited it, this request would
    // hang and lose the race below.
    const original = db.next.bind(db);
    db.next = () => new Promise(() => undefined) as never;
    try {
      const res = await Promise.race([
        call('POST', '/v1/auth/login', { as: null, body: { phone: '9876543210', password: 'x' } }),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500)),
      ]);
      expect(res).not.toBe('timeout');
      expect((res as { statusCode: number }).statusCode).toBe(401);
    } finally {
      db.next = original;
    }
  });

  it('records nothing for an upstream outage, which is not a wrong password', async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError(502, 'upstream', 'down'));
    await call('POST', '/v1/auth/login', { as: null, body: { phone: '9876543210', password: 'x' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stored('login_failed')).toBeUndefined();
  });
});

describe('signup events', () => {
  it('records a signup against the new artisan', async () => {
    vi.mocked(signUp).mockResolvedValue({ session, artisan: { id: ARTISAN } } as never);
    const res = await call('POST', '/v1/auth/signup', {
      as: null,
      body: { phone: '9876543210', password: 'secret1', full_name: 'Asha', craft_category: 'Pottery' },
    });

    expect(res.statusCode).toBe(201);
    await vi.waitFor(() => expect(stored('signup')).toBeDefined());
    expect(stored('signup')).toMatchObject({ artisan_id: ARTISAN });
  });
});
