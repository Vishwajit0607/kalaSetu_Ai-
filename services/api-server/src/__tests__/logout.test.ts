import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { call, setupAuth, teardownAuth } from './helpers/authedApp.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => db.reset());

const signOutCall = () => db.argsOf('admin.signOut') as [string, string] | undefined;
const loggedOut = () => (db.allOf('insert') as Array<[Record<string, unknown>]>).some(([row]) => row.event_type === 'logout');

describe('POST /v1/auth/logout', () => {
  it('ends only this device\'s session by default, using the caller\'s own token', async () => {
    const res = await call('POST', '/v1/auth/logout');

    expect(res.statusCode).toBe(204);
    const [token, scope] = signOutCall()!;
    expect(token.split('.')).toHaveLength(3); // a JWT: the token the caller sent
    expect(scope).toBe('local');
  });

  it('ends every session when asked', async () => {
    const res = await call('POST', '/v1/auth/logout', { body: { all_devices: true } });
    expect(res.statusCode).toBe(204);
    expect(signOutCall()![1]).toBe('global');
  });

  it('records the logout in the audit trail', async () => {
    await call('POST', '/v1/auth/logout');
    await vi.waitFor(() => expect(loggedOut()).toBe(true));
  });

  it('tells the caller, and records nothing, when the session could not be ended', async () => {
    db.admin.signOut = { error: { message: 'gotrue unavailable' } };
    const res = await call('POST', '/v1/auth/logout');

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loggedOut()).toBe(false);
  });

  it('requires a token, and never calls Supabase without one', async () => {
    const res = await call('POST', '/v1/auth/logout', { as: null });
    expect(res.statusCode).toBe(401);
    expect(signOutCall()).toBeUndefined();
  });

  it('rejects a malformed body', async () => {
    expect((await call('POST', '/v1/auth/logout', { body: { all_devices: 'yes' } })).statusCode).toBe(400);
    expect(signOutCall()).toBeUndefined();
  });
});
