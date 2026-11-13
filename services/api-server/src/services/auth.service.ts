import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { loadEnv } from '../config/env.js';
import { supabase } from './supabase.service.js';
import type { Artisan, SupportedLanguage } from '../types/index.js';

/**
 * Accounts.
 *
 * Identity is a mobile number plus a password, backed by Supabase Auth.
 *
 * Why not Supabase's own phone login: that needs an SMS provider (Twilio,
 * MSG91...) configured in the dashboard, which this project does not have, and
 * its email login sends confirmation mail through a shared sender capped at a
 * few messages an hour - unusable for a launch day of new artisans. So the
 * server creates pre-confirmed accounts through the admin API, using a
 * deterministic internal address derived from the phone number. The `.invalid`
 * TLD is reserved (RFC 2606) and can never receive mail, so that address is a
 * stable login key, never a contact channel.
 *
 * The consequence to state plainly: there is no password recovery yet. That
 * needs real phone OTP, which is the follow-up once an SMS provider exists.
 *
 * Tokens are Supabase's ES256 JWTs, verified locally against the project's
 * public JWKS - no network round trip per request, and no shared secret on
 * this server.
 */

export class AuthError extends Error {
  readonly status: number;
  readonly code:
    | 'invalid_credentials'
    | 'phone_taken'
    | 'invalid_phone'
    | 'weak_password'
    | 'wrong_password'
    | 'same_password'
    | 'invalid_token'
    | 'upstream';

  constructor(status: number, code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ phones */

/**
 * Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX), or null.
 *
 * Accepts what people actually type: `98765 43210`, `098765-43210`,
 * `+91 98765 43210`, `919876543210`. Indian mobiles start 6-9; anything else
 * is rejected here rather than becoming an account nobody can ever log into.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  let national: string;

  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else return null;

  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** Internal login identifier for a normalised phone. See the file header. */
export function authEmailFor(e164Phone: string): string {
  return `${e164Phone.replace(/[^\d]/g, '')}@phone.kalasetu.invalid`;
}

const MIN_PASSWORD_LENGTH = 6;

/* ----------------------------------------------------------------- clients */

let passwordClient: SupabaseClient | null = null;

/** Least-privileged client for password / refresh grants. */
function authClient(): SupabaseClient {
  if (!passwordClient) {
    const env = loadEnv();
    passwordClient = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return passwordClient;
}

/* ---------------------------------------------------------------- sessions */

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. The client refreshes shortly before this. */
  expires_at: number;
}

function toSession(raw: {
  access_token: string;
  refresh_token: string;
  expires_at?: number | undefined;
  expires_in?: number | undefined;
}): Session {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: raw.expires_at ?? Math.floor(Date.now() / 1000) + (raw.expires_in ?? 3600),
  };
}

/* ----------------------------------------------------------------- signup */

export interface SignUpInput {
  phone: string;
  password: string;
  fullName: string;
  craftCategory: string;
  clusterLocation?: string | null;
  preferredLanguage: SupportedLanguage;
}

export async function signUp(input: SignUpInput): Promise<{ session: Session; artisan: Artisan }> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new AuthError(400, 'invalid_phone', 'Enter a valid 10-digit Indian mobile number');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(400, 'weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const email = authEmailFor(phone);

  const created = await supabase().auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { phone },
  });

  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'unknown';
    // GoTrue reports a duplicate as "already been registered" / code email_exists.
    if (/already|exists|registered/i.test(message)) {
      throw new AuthError(409, 'phone_taken', 'An account with this phone number already exists');
    }
    throw new AuthError(502, 'upstream', `Could not create the account: ${message}`);
  }

  const userId = created.data.user.id;

  // The artisan row shares its id with the auth user. That is what makes the
  // `auth.uid() = id` row-level-security policies in the migration actually
  // mean something, and it means a token's `sub` *is* the artisan id.
  const inserted = await supabase()
    .from('artisans')
    .insert({
      id: userId,
      phone_number: phone,
      full_name: input.fullName.trim(),
      preferred_language: input.preferredLanguage,
      craft_category: input.craftCategory.trim(),
      cluster_location: input.clusterLocation?.trim() || null,
      gi_tag_certified: false,
    })
    .select()
    .single();

  if (inserted.error || !inserted.data) {
    // Half an account is worse than none: an auth user with no profile can log
    // in but every request after would 404. Roll the auth user back.
    await supabase().auth.admin.deleteUser(userId).catch(() => undefined);

    if (inserted.error?.code === '23505') {
      throw new AuthError(409, 'phone_taken', 'An account with this phone number already exists');
    }
    throw new AuthError(502, 'upstream', `Could not save the profile: ${inserted.error?.message ?? 'unknown'}`);
  }

  const { session } = await signIn({ phone, password: input.password });
  return { session, artisan: inserted.data as Artisan };
}

/* ------------------------------------------------------------------ login */

export async function signIn(input: {
  phone: string;
  password: string;
}): Promise<{ session: Session; artisan: Artisan }> {
  const phone = normalizePhone(input.phone);
  // One generic failure for "bad phone" and "wrong password" alike: telling
  // them apart lets anyone probe which numbers have accounts.
  const invalid = new AuthError(401, 'invalid_credentials', 'Wrong phone number or password');
  if (!phone) throw invalid;

  const result = await authClient().auth.signInWithPassword({
    email: authEmailFor(phone),
    password: input.password,
  });

  if (result.error || !result.data.session) {
    const status = result.error?.status ?? 0;
    if (status >= 500 || status === 429) {
      throw new AuthError(502, 'upstream', 'Sign-in is temporarily unavailable');
    }
    throw invalid;
  }

  const artisan = await getArtisan(result.data.user.id);
  if (!artisan) {
    // An auth user whose profile row is gone (deleted account, failed
    // rollback). Treat as invalid rather than leaking the state.
    throw invalid;
  }

  return { session: toSession(result.data.session), artisan };
}

export async function refreshSession(refreshToken: string): Promise<Session> {
  const result = await authClient().auth.refreshSession({ refresh_token: refreshToken });
  if (result.error || !result.data.session) {
    const status = result.error?.status ?? 0;
    if (status >= 500 || status === 429) {
      throw new AuthError(502, 'upstream', 'Session refresh is temporarily unavailable');
    }
    throw new AuthError(401, 'invalid_token', 'Session expired, please log in again');
  }
  return toSession(result.data.session);
}

/* ----------------------------------------------------------------- logout */

/**
 * End the caller's session on the server, so the refresh token stops working too.
 *
 * Just forgetting the token on the phone (what logout used to do) leaves a stolen
 * or lost copy of that session alive until it expires. `local` ends only the
 * session this token belongs to, so logging out on one phone does not log the
 * artisan out of another; `global` ends every session they have.
 */
export async function revokeSession(accessToken: string, scope: 'local' | 'global'): Promise<void> {
  const { error } = await supabase().auth.admin.signOut(accessToken, scope);
  if (error) {
    throw new AuthError(502, 'upstream', `Could not end the session: ${error.message}`);
  }
}

/* ---------------------------------------------------------- password change */

export interface ChangePasswordInput {
  artisanId: string;
  currentPassword: string;
  newPassword: string;
  /** The caller's own token, so their *other* sessions can be ended. */
  accessToken: string;
}

/**
 * Change the signed-in artisan's password.
 *
 * The current password is required even though the caller already has a valid
 * token: a token proves the phone was unlocked, not that the person holding it
 * knows the password. Without the check, anyone who picks up an unlocked phone
 * could lock the owner out of their own account.
 *
 * Afterwards every OTHER session is ended, so whoever else was signed in with the
 * old password is signed out; this one stays.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(400, 'weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (input.newPassword === input.currentPassword) {
    throw new AuthError(400, 'same_password', 'Choose a password different from the current one');
  }

  const artisan = await getArtisan(input.artisanId);
  if (!artisan) throw new AuthError(401, 'invalid_token', 'This account no longer exists');

  // 1. Prove they know the current password.
  const check = await authClient().auth.signInWithPassword({
    email: authEmailFor(artisan.phone_number),
    password: input.currentPassword,
  });
  if (check.error || !check.data.session) {
    const status = check.error?.status ?? 0;
    if (status >= 500 || status === 429) {
      throw new AuthError(502, 'upstream', 'Password change is temporarily unavailable');
    }
    // 400, not 401: the mobile client treats a 401 as "session expired" and would
    // log the artisan out for a mistyped current password.
    throw new AuthError(400, 'wrong_password', 'The current password is not correct');
  }

  // The check created a session we do not need. End it so it does not linger.
  await supabase().auth.admin.signOut(check.data.session.access_token, 'local').catch(() => undefined);

  // 2. Set the new one.
  const updated = await supabase().auth.admin.updateUserById(input.artisanId, { password: input.newPassword });
  if (updated.error) {
    if (/password/i.test(updated.error.message) && /(weak|short|least|character)/i.test(updated.error.message)) {
      throw new AuthError(400, 'weak_password', updated.error.message);
    }
    throw new AuthError(502, 'upstream', `Could not change the password: ${updated.error.message}`);
  }

  // 3. End every other session. Best effort: the password has already changed.
  await supabase().auth.admin.signOut(input.accessToken, 'others').catch(() => undefined);
}

/* ---------------------------------------------------------------- profile */

export async function getArtisan(id: string): Promise<Artisan | null> {
  const { data } = await supabase().from('artisans').select('*').eq('id', id).maybeSingle();
  return (data as Artisan | null) ?? null;
}

/* ----------------------------------------------------------- verification */

let keyResolver: JWTVerifyGetKey | null = null;

function resolver(): JWTVerifyGetKey {
  if (!keyResolver) {
    const { SUPABASE_URL } = loadEnv();
    // jose caches the key set and re-fetches on an unknown `kid`, so Supabase
    // rotating its signing key does not need a restart here.
    keyResolver = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), {
      timeoutDuration: 4000,
      cooldownDuration: 30_000,
    });
  }
  return keyResolver;
}

/** Test seam: swap in a local key set so tests never touch the network. */
export function setKeyResolverForTests(next: JWTVerifyGetKey | null): void {
  keyResolver = next;
}

/** Returns the artisan id (the token's `sub`) or throws AuthError. */
export async function verifyAccessToken(token: string): Promise<string> {
  const { SUPABASE_URL } = loadEnv();
  try {
    const { payload } = await jwtVerify(token, resolver(), {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256'],
    });

    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
      throw new AuthError(401, 'invalid_token', 'Invalid session');
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // Expired, wrong issuer/audience, bad signature, malformed, JWKS
    // unreachable: all mean "this request is not authenticated". None of them
    // may surface as a 500.
    throw new AuthError(401, 'invalid_token', 'Invalid or expired session');
  }
}

/* --------------------------------------------------------------- deletion */

/**
 * Delete an account and everything it owns.
 *
 * Order matters. Storage first (while we still know the artisan id), then the
 * artisan row (products, inquiries and stock movements go with it through the
 * ON DELETE CASCADE foreign keys), then the auth user last - so a failure
 * part-way leaves an account that can still log in and retry, not an orphaned
 * row nobody can reach.
 */
export async function deleteAccount(artisanId: string): Promise<void> {
  const { removeAllMediaFor } = await import('./supabase.service.js');
  await removeAllMediaFor(artisanId);

  const removed = await supabase().from('artisans').delete().eq('id', artisanId);
  if (removed.error) {
    throw new AuthError(502, 'upstream', `Could not delete the profile: ${removed.error.message}`);
  }

  const user = await supabase().auth.admin.deleteUser(artisanId);
  if (user.error) {
    throw new AuthError(502, 'upstream', `Could not delete the login: ${user.error.message}`);
  }
}
