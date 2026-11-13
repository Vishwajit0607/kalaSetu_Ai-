import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});
// The credential and deletion machinery has its own tests; what is checked here is
// WHO the route says it is acting for.
vi.mock('../services/auth.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/auth.service.js')>();
  return { ...original, changePassword: vi.fn(), deleteAccount: vi.fn() };
});

import { changePassword, deleteAccount } from '../services/auth.service.js';

/**
 * The one rule behind every account endpoint: **identity comes from the token,
 * never from the request.**
 *
 * Each endpoint is called as two different people while the request names a third.
 * Every artisan id the server then uses - in a database filter, in a write, or
 * handed to the password or deletion service - must be the caller's.
 */

const THIRD = '77777777-6666-5555-4444-333333333333';

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  answers?: () => Array<Record<string, unknown>>;
}

const profileRow = (id: string) => ({ id, phone_number: '+919876543210', full_name: 'Asha', craft_category: 'Pottery' });

const cases: Case[] = [
  { name: 'GET /v1/me', method: 'GET', url: `/v1/me?id=${THIRD}&artisan_id=${THIRD}`, answers: () => [{ data: profileRow('x') }] },
  {
    name: 'PATCH /v1/me',
    method: 'PATCH',
    url: '/v1/me',
    body: { full_name: 'New Name', id: THIRD, artisan_id: THIRD },
    answers: () => [{ data: profileRow('x') }],
  },
  { name: 'DELETE /v1/me', method: 'DELETE', url: `/v1/me?id=${THIRD}` },
  { name: 'POST /v1/auth/logout', method: 'POST', url: '/v1/auth/logout', body: { all_devices: false } },
  {
    name: 'POST /v1/me/password',
    method: 'POST',
    url: '/v1/me/password',
    body: { current_password: 'old-pass-1', new_password: 'new-pass-2', artisan_id: THIRD, id: THIRD },
  },
  { name: 'GET /v1/me/activity', method: 'GET', url: `/v1/me/activity?artisan_id=${THIRD}`, answers: () => [{ data: [] }] },
  {
    name: 'GET /v1/me/export',
    method: 'GET',
    url: `/v1/me/export?artisan_id=${THIRD}`,
    answers: () => [{ data: profileRow('x') }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }],
  },
];

/** The subject (`sub`) of the JWT a call used to authenticate. */
const subjectOf = (token: string): string => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub;

/** Every artisan id the server used, across every place one can appear. */
function idsUsed(): string[] {
  const ids: string[] = [];
  for (const [column, value] of db.allOf('eq') as Array<[string, string]>) {
    if (column === 'id' || column === 'artisan_id' || column === 'buyer_artisan_id') ids.push(value);
  }
  for (const [row] of db.allOf('insert') as Array<[Record<string, unknown>]>) {
    if (typeof row.artisan_id === 'string') ids.push(row.artisan_id);
  }
  for (const [call_] of vi.mocked(changePassword).mock.calls) ids.push(call_.artisanId);
  for (const [id] of vi.mocked(deleteAccount).mock.calls) ids.push(id);
  // logout acts on the session of the token it was sent, which must be the caller's
  const signOut = db.argsOf('admin.signOut') as [string, string] | undefined;
  if (signOut) ids.push(subjectOf(signOut[0]));
  return ids;
}

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  db.reset();
  vi.mocked(changePassword).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteAccount).mockReset().mockResolvedValue(undefined);
});

describe.each(cases)('$name', (c) => {
  it('refuses a request with no token, without touching the database or any service', async () => {
    const res = await call(c.method, c.url, { as: null, body: c.body });
    expect(res.statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
    expect(changePassword).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['ME', ME],
    ['OTHER', OTHER],
  ])('acts only as the token\'s artisan (%s), whoever the request names', async (_label, caller) => {
    if (c.answers) db.answer(...(c.answers() as never[]));
    await call(c.method, c.url, { as: caller, body: c.body });

    const used = idsUsed();
    expect(used.length, 'the endpoint should scope its work to an artisan').toBeGreaterThan(0);
    for (const id of used) expect(id).toBe(caller);
    expect(used).not.toContain(THIRD);
  });
});
