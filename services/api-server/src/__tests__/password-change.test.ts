import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

// The "least-privileged" client the service uses to check a password.
const signInWithPassword = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...original, createClient: () => ({ auth: { signInWithPassword } }) };
});

import { AuthError, changePassword } from '../services/auth.service.js';

const ARTISAN = 'aaaaaaaa-0000-0000-0000-000000000001';
const input = { artisanId: ARTISAN, currentPassword: 'old-pass-1', newPassword: 'new-pass-2', accessToken: 'tok-abc' };
const checkOk = { data: { session: { access_token: 'verify-tok' } }, error: null };

beforeEach(() => {
  db.reset();
  signInWithPassword.mockReset();
});

const failsWith = async (promise: Promise<unknown>, code: AuthError['code'], status: number) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code, status });
};

const calls = () => db.calls.map(([name]) => name).filter((n) => n.startsWith('admin.'));

describe('changePassword', () => {
  it('checks the current password, sets the new one, and ends the other sessions', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue(checkOk);

    await expect(changePassword(input)).resolves.toBeUndefined();

    // verified against THIS artisan's own login address, not anything the caller supplied
    expect(signInWithPassword).toHaveBeenCalledWith({ email: '919876543210@phone.kalasetu.invalid', password: 'old-pass-1' });
    expect(db.argsOf('admin.updateUserById')).toEqual([ARTISAN, { password: 'new-pass-2' }]);
    // the throwaway verification session is ended, then the caller's other sessions
    expect(db.allOf('admin.signOut')).toEqual([['verify-tok', 'local'], ['tok-abc', 'others']]);
  });

  it('refuses a wrong current password with a 400 (never 401), and changes nothing', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { status: 400, message: 'Invalid login credentials' } });

    await failsWith(changePassword(input), 'wrong_password', 400);
    expect(calls()).toEqual([]);
  });

  it('refuses a new password that is too short, before touching anything', async () => {
    await failsWith(changePassword({ ...input, newPassword: 'abc' }), 'weak_password', 400);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a new password identical to the current one', async () => {
    await failsWith(changePassword({ ...input, newPassword: input.currentPassword }), 'same_password', 400);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('reports an outage while checking as upstream, not as a wrong password', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { status: 503, message: 'down' } });
    await failsWith(changePassword(input), 'upstream', 502);
  });

  it('rejects an account that no longer exists', async () => {
    db.answer({ data: null });
    await failsWith(changePassword(input), 'invalid_token', 401);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('reports a failure to set the password, and does not end other sessions', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue(checkOk);
    db.admin.updateUserById = { data: null, error: { message: 'database error' } };

    await failsWith(changePassword(input), 'upstream', 502);
    expect(db.allOf('admin.signOut').map(([, scope]) => scope)).toEqual(['local']); // only the verification session
  });

  it('maps the provider\'s own weak-password complaint to weak_password', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue(checkOk);
    db.admin.updateUserById = { data: null, error: { message: 'Password should be at least 8 characters' } };
    await failsWith(changePassword(input), 'weak_password', 400);
  });

  it('still succeeds if ending the other sessions fails, because the password has already changed', async () => {
    db.answer({ data: { id: ARTISAN, phone_number: '+919876543210' } });
    signInWithPassword.mockResolvedValue(checkOk);
    db.admin.signOut = { error: { message: 'unavailable' } };
    await expect(changePassword(input)).resolves.toBeUndefined();
  });
});
