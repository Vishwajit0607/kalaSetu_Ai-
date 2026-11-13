import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTPayload, type KeyLike } from 'jose';
import {
  AuthError,
  authEmailFor,
  normalizePhone,
  setKeyResolverForTests,
  verifyAccessToken,
} from '../services/auth.service.js';
import { storagePathFromUrl } from '../services/supabase.service.js';
import { buildServer } from '../index.js';

const ISSUER = `${process.env.SUPABASE_URL}/auth/v1`;
const ARTISAN = '11111111-2222-3333-4444-555555555555';

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;

async function sign(overrides: Partial<JWTPayload> = {}, key: KeyLike = privateKey, kid = 'test-key') {
  return new SignJWT({ role: 'authenticated', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setSubject(ARTISAN)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('ES256')).privateKey;

  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  setKeyResolverForTests(createLocalJWKSet({ keys: [jwk] }));
});

afterAll(() => setKeyResolverForTests(null));

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['too short', '98765'],
    ['too long', '98765432101234'],
    ['landline-style prefix', '1234567890'],
    ['not a number', 'hello'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('maps every spelling of one number to the same login address', () => {
    const a = authEmailFor(normalizePhone('98765 43210') as string);
    const b = authEmailFor(normalizePhone('+91-9876543210') as string);
    expect(a).toBe(b);
    expect(a.endsWith('@phone.kalasetu.invalid')).toBe(true);
  });
});

describe('verifyAccessToken', () => {
  it('returns the artisan id from a valid token', async () => {
    expect(await verifyAccessToken(await sign())).toBe(ARTISAN);
  });

  it('rejects a token signed with a different key', async () => {
    const forged = await sign({}, otherPrivateKey);
    await expect(verifyAccessToken(forged)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(ARTISAN)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    await expect(verifyAccessToken(expired)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a token from another issuer', async () => {
    const wrong = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(ARTISAN)
      .setIssuer('https://evil.example/auth/v1')
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(verifyAccessToken(wrong)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a service-role style token even if correctly signed', async () => {
    await expect(verifyAccessToken(await sign({ role: 'service_role' }))).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects garbage without throwing a non-auth error', async () => {
    await expect(verifyAccessToken('not-a-jwt')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('storagePathFromUrl (media ownership)', () => {
  const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/kalasetu-media`;

  it('accepts the caller\'s own upload', () => {
    expect(storagePathFromUrl(`${base}/${ARTISAN}/raw/abc.jpg`, ARTISAN)).toBe(`${ARTISAN}/raw/abc.jpg`);
  });

  it('rejects another artisan\'s upload', () => {
    expect(storagePathFromUrl(`${base}/99999999-0000-0000-0000-000000000000/raw/abc.jpg`, ARTISAN)).toBeNull();
  });

  it('rejects an on-device file:// path - the bug that saved unloadable photos', () => {
    expect(storagePathFromUrl('file:///data/user/0/host.exp.exponent/cache/photo.jpg', ARTISAN)).toBeNull();
  });

  it('rejects a foreign host', () => {
    expect(storagePathFromUrl(`https://evil.example/${ARTISAN}/raw/abc.jpg`, ARTISAN)).toBeNull();
  });

  it('rejects path traversal into someone else\'s folder', () => {
    expect(storagePathFromUrl(`${base}/${ARTISAN}/../99999999-0000-0000-0000-000000000000/raw/x.jpg`, ARTISAN)).toBeNull();
  });
});

describe('route protection', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/v1/me'],
    ['DELETE', '/v1/me'],
    ['GET', '/v1/inventory'],
    ['PATCH', '/v1/inventory/11111111-2222-3333-4444-555555555555/stock'],
    ['GET', '/v1/inventory/11111111-2222-3333-4444-555555555555/qr'],
    ['POST', '/v1/vision/edit'],
    ['POST', '/v1/vision/media/remove'],
    ['POST', '/v1/catalog/generate'],
    ['POST', '/v1/catalog/products'],
    ['POST', '/v1/catalog/price'],
    ['POST', '/v1/marketplace/export'],
    ['GET', '/v1/marketplace/status'],
    ['GET', '/v1/marketplace/inquiries'],
    ['GET', '/v1/marketplace/listings'],
    ['GET', '/v1/marketplace/listings/11111111-2222-3333-4444-555555555555'],
    ['GET', '/v1/marketplace/crafts'],
  ];

  it.each(protectedRoutes)('%s %s returns 401 with no token', async (method, url) => {
    const app = await buildServer();
    const res = await app.inject({ method: method as 'GET', url });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
    await app.close();
  });

  it('401s on a forged token and speaks the failure in the caller\'s language', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inventory',
      headers: { authorization: `Bearer ${await sign({}, otherPrivateKey)}`, 'x-lang': 'en-IN' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().spoken_hi).toBe('Please log in again.');
    await app.close();
  });

  it('leaves the public and onboarding routes open', async () => {
    const app = await buildServer();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const langs = await app.inject({ method: 'GET', url: '/v1/speech/languages' });
    expect(langs.statusCode).toBe(200);
    expect(langs.json().languages.map((l: { code: string }) => l.code)).toEqual(['hi-IN', 'en-IN']);
    await app.close();
  });

  it('validates signup input before touching Supabase', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { phone: '12', password: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
