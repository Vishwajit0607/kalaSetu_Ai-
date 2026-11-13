import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type KeyLike } from 'jose';
import { setKeyResolverForTests } from '../../services/auth.service.js';
import { buildServer } from '../../index.js';

/**
 * Real server, real token checks, fake database.
 *
 * Tokens are signed with a throwaway key that the server is told to trust for
 * this test run, so the authentication path being exercised is the production
 * one (signature, issuer, audience, expiry) - only the key differs.
 */

export const ME = '11111111-2222-3333-4444-555555555555';
export const OTHER = '99999999-8888-7777-6666-555555555555';

let privateKey: KeyLike;

export async function setupAuth(): Promise<void> {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  setKeyResolverForTests(createLocalJWKSet({ keys: [jwk] }));
}

export function teardownAuth(): void {
  setKeyResolverForTests(null);
}

export async function tokenFor(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(sub)
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

export interface CallOptions {
  /** Who is calling. Defaults to ME. Pass `null` for no token. */
  as?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, options: CallOptions = {}) {
  const app = await buildServer();
  const as = options.as === undefined ? ME : options.as;
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(as ? { authorization: `Bearer ${await tokenFor(as)}` } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
  });
  await app.close();
  return res;
}
