import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type FakeResult } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

const translateText = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase, removeMedia: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../services/sarvam.service.js', () => ({ translateText }));

/**
 * The one rule behind every endpoint in the product lifecycle module: **identity comes
 * from the token, never from the request.**
 *
 * Each endpoint is called as two different people while the request names a third.
 * Every artisan id the server then uses must be the caller's; a request that tries to
 * NAME an owner in its body must be refused before any database access; and a missing
 * token must be a 401 that touches nothing.
 */

const PRODUCT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const THIRD = '77777777-6666-5555-4444-333333333333';
const base = `/v1/catalog/products/${PRODUCT}`;

const product = (caller: string) => ({
  id: PRODUCT,
  artisan_id: caller,
  title_en: 'Pot',
  title_hi: 'मटका',
  description_en: 'd',
  description_hi: 'd',
  enhanced_image_url: 'https://cdn.example/c.jpg',
  recommended_retail_inr: '1000.00',
  recommended_wholesale_inr: '700.00',
  dimensions_cm: { length: 1, width: 1, height: 1 },
});

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  answers: (caller: string) => Array<Partial<FakeResult>>;
  /** A version of the request that tries to name an owner in the body. Refused with a 400. */
  naming?: unknown;
}

const cases: Case[] = [
  { name: 'GET /:id', method: 'GET', url: `${base}?artisan_id=${THIRD}`, answers: (c) => [{ data: product(c) }] },
  {
    name: 'PATCH /:id',
    method: 'PATCH',
    url: base,
    body: { title_en: 'New' },
    answers: (c) => [{ data: product(c) }, { data: product(c) }],
    naming: { title_en: 'New', artisan_id: THIRD },
  },
  { name: 'DELETE /:id', method: 'DELETE', url: `${base}?artisan_id=${THIRD}`, answers: () => [{ data: { id: PRODUCT, deleted_at: 'x' } }] },
  { name: 'POST /:id/restore', method: 'POST', url: `${base}/restore`, answers: (c) => [{ data: product(c) }] },
  { name: 'GET /:id/price-history', method: 'GET', url: `${base}/price-history?artisan_id=${THIRD}`, answers: (c) => [{ data: product(c) }, { data: [] }] },
  {
    name: 'POST /:id/retranslate',
    method: 'POST',
    url: `${base}/retranslate`,
    body: { from: 'en-IN', apply: true },
    answers: (c) => [{ data: product(c) }, { data: product(c) }, { data: product(c) }],
    naming: { from: 'en-IN', artisan_id: THIRD },
  },
];

const callerIdsUsed = (): string[] =>
  (db.allOf('eq') as Array<[string, string]>)
    .filter(([column]) => column === 'artisan_id')
    .map(([, value]) => value);

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  db.reset();
  translateText.mockReset().mockResolvedValue({ text: 'translated' });
});

describe.each(cases)('$name', (c) => {
  it('refuses a request with no token, without touching the database or the translator', async () => {
    const res = await call(c.method, c.url, { as: null, body: c.body });
    expect(res.statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
    expect(translateText).not.toHaveBeenCalled();
  });

  it.each([
    ['ME', ME],
    ['OTHER', OTHER],
  ])('acts only as the token\'s artisan (%s), whoever the request names', async (_label, caller) => {
    db.answer(...c.answers(caller));
    await call(c.method, c.url, { as: caller, body: c.body });

    const used = callerIdsUsed();
    expect(used.length, 'the endpoint should scope its queries to an artisan').toBeGreaterThan(0);
    for (const id of used) expect(id).toBe(caller);
    expect(used).not.toContain(THIRD);
  });

  if (c.naming !== undefined) {
    it('refuses a body that tries to name an owner, with a 400 and no database access at all', async () => {
      const res = await call(c.method, c.url, { as: ME, body: c.naming });
      expect(res.statusCode).toBe(400);
      expect(db.calls).toHaveLength(0);
    });
  }
});

describe('the creating endpoint is untouched and still needs a token', () => {
  it('POST /v1/catalog/products is still protected', async () => {
    expect((await call('POST', '/v1/catalog/products', { as: null, body: {} })).statusCode).toBe(401);
  });
});
