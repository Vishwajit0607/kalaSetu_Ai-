import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

// The service has its own tests; here we check what the ROUTE does around it.
vi.mock('../services/auth.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/auth.service.js')>();
  return { ...original, changePassword: vi.fn() };
});

import { AuthError, changePassword } from '../services/auth.service.js';

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  db.reset();
  vi.mocked(changePassword).mockReset();
});

const change = (body: unknown, options: { as?: string | null; lang?: string } = {}) =>
  call('POST', '/v1/me/password', { as: options.as, body, headers: options.lang ? { 'x-lang': options.lang } : undefined });

const passwordEvent = () =>
  (db.allOf('insert') as Array<[Record<string, unknown>]>).find(([row]) => row.event_type === 'password_changed')?.[0];

describe('POST /v1/me/password', () => {
  it('changes the password for the signed-in artisan and says so in their language', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    const res = await change({ current_password: 'old-pass-1', new_password: 'new-pass-2' }, { lang: 'en-IN' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changed: true, spoken_hi: 'Your password has been changed.' });
    expect(changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ artisanId: ME, currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }),
    );
    // the caller's own token is handed on, so their OTHER sessions can be ended
    expect(vi.mocked(changePassword).mock.calls[0]![0].accessToken.split('.')).toHaveLength(3);
  });

  it('always acts on the token\'s artisan, never on one named in the body', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    await change({ current_password: 'a', new_password: 'bbbbbb', artisan_id: OTHER, id: OTHER }, { as: ME });
    expect(vi.mocked(changePassword).mock.calls[0]![0].artisanId).toBe(ME);

    vi.mocked(changePassword).mockClear();
    await change({ current_password: 'a', new_password: 'bbbbbb', artisan_id: ME }, { as: OTHER });
    expect(vi.mocked(changePassword).mock.calls[0]![0].artisanId).toBe(OTHER);
  });

  it('records the change in the audit trail', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    await change({ current_password: 'old-pass-1', new_password: 'new-pass-2' });
    await vi.waitFor(() => expect(passwordEvent()).toMatchObject({ artisan_id: ME, event_type: 'password_changed' }));
  });

  it('turns a wrong current password into a 400 with a spoken reason, and records nothing', async () => {
    vi.mocked(changePassword).mockRejectedValue(new AuthError(400, 'wrong_password', 'The current password is not correct'));
    const res = await change({ current_password: 'nope', new_password: 'new-pass-2' }, { lang: 'en-IN' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'wrong_password', spoken_hi: expect.stringContaining('current password') });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(passwordEvent()).toBeUndefined();
  });

  it('speaks the failure in Hindi when the app is in Hindi', async () => {
    vi.mocked(changePassword).mockRejectedValue(new AuthError(400, 'same_password', 'same'));
    const res = await change({ current_password: 'aaaaaa', new_password: 'aaaaaa' }, { lang: 'hi-IN' });
    expect(res.json().spoken_hi).toMatch(/[ऀ-ॿ]/);
  });

  it('rejects a missing or oversized field before reaching the service', async () => {
    expect((await change({ current_password: 'x' })).statusCode).toBe(400);
    expect((await change({ new_password: 'x' })).statusCode).toBe(400);
    expect((await change({ current_password: '', new_password: 'abcdef' })).statusCode).toBe(400);
    expect((await change({ current_password: 'x', new_password: 'y'.repeat(73) })).statusCode).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    const res = await change({ current_password: 'a', new_password: 'bbbbbb' }, { as: null });
    expect(res.statusCode).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('is rate limited, because it is a password-guessing target', async () => {
    vi.mocked(changePassword).mockRejectedValue(new AuthError(400, 'wrong_password', 'nope'));
    // Same server instance for every attempt, so the counter accumulates.
    const { buildServer } = await import('../index.js');
    const { tokenFor } = await import('./helpers/authedApp.js');
    const app = await buildServer();
    const headers = { authorization: `Bearer ${await tokenFor(ME)}` };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/v1/me/password', headers, payload: { current_password: 'guess', new_password: 'abcdef' } });
      statuses.push(res.statusCode);
    }
    await app.close();

    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
