import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

const removeMedia = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase, removeMedia };
});

const PRODUCT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const row = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  artisan_id: ME,
  title_en: 'Blue Pot',
  recommended_retail_inr: '1000.00',
  recommended_wholesale_inr: '700.00',
  dimensions_cm: { length: 10, width: 10, height: 5 },
  ...over,
});

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  db.reset();
  removeMedia.mockReset().mockResolvedValue(undefined);
});

describe('GET /v1/catalog/products/:id', () => {
  it('returns the caller\'s product', async () => {
    db.answer({ data: row() });
    const res = await call('GET', `/v1/catalog/products/${PRODUCT}`);

    expect(res.statusCode).toBe(200);
    expect(res.json().product).toMatchObject({ id: PRODUCT, title_en: 'Blue Pot' });
    expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
  });

  it('is a 404 for a product that is not theirs, a missing one, or a deleted one', async () => {
    db.answer({ data: null });
    expect((await call('GET', `/v1/catalog/products/${PRODUCT}`, { as: OTHER })).statusCode).toBe(404);
    expect(db.allOf('is')).toContainEqual(['deleted_at', null]);
  });

  it('rejects an id that is not a UUID, and requires a token', async () => {
    expect((await call('GET', '/v1/catalog/products/not-a-uuid')).statusCode).toBe(400);
    expect((await call('GET', `/v1/catalog/products/${PRODUCT}`, { as: null })).statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});

describe('PATCH /v1/catalog/products/:id', () => {
  it('changes what was sent and returns the updated product', async () => {
    db.answer({ data: row() }, { data: row({ title_en: 'Green Pot' }) });
    const res = await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { body: { title_en: 'Green Pot' } });

    expect(res.statusCode).toBe(200);
    expect(res.json().product.title_en).toBe('Green Pot');
    const [written] = db.argsOf('update') as [Record<string, unknown>];
    expect(written.title_en).toBe('Green Pot');
  });

  it('REFUSES stock and every other protected field with a 400, writing nothing', async () => {
    for (const body of [
      { title_en: 'x', stock_quantity: 5 },
      { title_en: 'x', artisan_id: OTHER },
      { title_en: 'x', sku: 'KS-HACK-000000' },
      { title_en: 'x', deleted_at: null },
    ]) {
      const res = await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { body });
      expect(res.statusCode).toBe(400);
    }
    expect(db.calls).toHaveLength(0);
  });

  it('refuses an empty change and invalid values', async () => {
    for (const body of [{}, { recommended_retail_inr: -1 }, { title_en: '' }, { min_wholesale_qty: 0 }]) {
      expect((await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { body })).statusCode).toBe(400);
    }
  });

  it('is a 400 when the new retail price is not above wholesale', async () => {
    db.answer({ data: row() });
    const res = await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { body: { recommended_retail_inr: 600 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/retail price must be higher/);
  });

  it('is a 404 for someone else\'s product, writing nothing', async () => {
    db.answer({ data: null });
    const res = await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { as: OTHER, body: { title_en: 'x' } });
    expect(res.statusCode).toBe(404);
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('requires a token', async () => {
    expect((await call('PATCH', `/v1/catalog/products/${PRODUCT}`, { as: null, body: { title_en: 'x' } })).statusCode).toBe(401);
  });
});

describe('DELETE /v1/catalog/products/:id', () => {
  it('hides the product and says it can be restored', async () => {
    db.answer({ data: { id: PRODUCT, deleted_at: '2026-11-13T10:00:00.000Z' } });
    const res = await call('DELETE', `/v1/catalog/products/${PRODUCT}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true, id: PRODUCT, deleted_at: '2026-11-13T10:00:00.000Z', restorable: true });
    expect(db.argsOf('delete')).toBeUndefined(); // nothing is actually removed
    expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
  });

  it('is a 404 for someone else\'s product, a missing one, or one already deleted', async () => {
    db.answer({ data: null });
    expect((await call('DELETE', `/v1/catalog/products/${PRODUCT}`, { as: OTHER })).statusCode).toBe(404);
  });

  it('rejects a bad id, and requires a token', async () => {
    expect((await call('DELETE', '/v1/catalog/products/nope')).statusCode).toBe(400);
    expect((await call('DELETE', `/v1/catalog/products/${PRODUCT}`, { as: null })).statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});

describe('POST /v1/catalog/products/:id/restore', () => {
  it('brings a deleted product back', async () => {
    db.answer({ data: row({ deleted_at: null }) });
    const res = await call('POST', `/v1/catalog/products/${PRODUCT}/restore`);

    expect(res.statusCode).toBe(200);
    expect(res.json().product).toMatchObject({ id: PRODUCT, deleted_at: null });
    expect(db.allOf('not')).toContainEqual(['deleted_at', 'is', null]);
  });

  it('is a 404 if the product is not deleted, not the caller\'s, or missing', async () => {
    db.answer({ data: null });
    const res = await call('POST', `/v1/catalog/products/${PRODUCT}/restore`, { as: OTHER });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/deleted product not found/);
  });

  it('rejects a bad id, and requires a token', async () => {
    expect((await call('POST', '/v1/catalog/products/nope/restore')).statusCode).toBe(400);
    expect((await call('POST', `/v1/catalog/products/${PRODUCT}/restore`, { as: null })).statusCode).toBe(401);
  });
});

describe('GET /v1/catalog/products/:id/price-history', () => {
  const point = (n: number, retail: number) => ({ id: `h${n}`, retail_inr: String(retail), wholesale_inr: '500', source: 'edit', changed_at: `2026-11-1${n}T10:00:00.000Z` });

  it('returns the history with the change from the previous price', async () => {
    db.answer({ data: row() }, { data: [point(2, 1100), point(1, 1000)] });
    const res = await call('GET', `/v1/catalog/products/${PRODUCT}/price-history`);

    expect(res.statusCode).toBe(200);
    expect(res.json().history.map((h: { retail_inr: number; retail_change: number | null }) => [h.retail_inr, h.retail_change])).toEqual([[1100, 100], [1000, null]]);
    expect(res.json().next_before).toBeNull();
  });

  it('is a 404 for someone else\'s product and reads no history', async () => {
    db.answer({ data: null });
    expect((await call('GET', `/v1/catalog/products/${PRODUCT}/price-history`, { as: OTHER })).statusCode).toBe(404);
    expect(db.allOf('from').map((a) => a[0])).toEqual(['products']);
  });

  it('pages with limit and a cursor', async () => {
    db.answer({ data: row() }, { data: [] });
    await call('GET', `/v1/catalog/products/${PRODUCT}/price-history?limit=5&before=2026-11-12T10:00:00.000Z`);
    expect(db.argsOf('limit')).toEqual([6]);
    expect(db.argsOf('lt')).toEqual(['changed_at', '2026-11-12T10:00:00.000Z']);
  });

  it('rejects a bad limit, cursor or id, and requires a token', async () => {
    for (const q of ['limit=0', 'limit=51', 'limit=abc', 'before=yesterday']) {
      expect((await call('GET', `/v1/catalog/products/${PRODUCT}/price-history?${q}`)).statusCode).toBe(400);
    }
    expect((await call('GET', '/v1/catalog/products/nope/price-history')).statusCode).toBe(400);
    expect((await call('GET', `/v1/catalog/products/${PRODUCT}/price-history`, { as: null })).statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
