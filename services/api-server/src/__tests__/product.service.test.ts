import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

const removeMedia = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase, removeMedia };
});

import {
  ProductError,
  getOwnedProduct,
  planPhotos,
  productPatchSchema,
  requireOwnedProduct,
  restoreProduct,
  softDeleteProduct,
  updateProduct,
} from '../services/product.service.js';

const ARTISAN = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODUCT = '11111111-0000-0000-0000-000000000001';

beforeEach(() => {
  db.reset();
  removeMedia.mockReset().mockResolvedValue(undefined);
});

describe('getOwnedProduct', () => {
  it('reads the product only if it belongs to the caller, and hides a deleted one', async () => {
    db.answer({ data: { id: PRODUCT, artisan_id: ARTISAN } });
    const product = await getOwnedProduct(ARTISAN, PRODUCT);

    expect(product).toMatchObject({ id: PRODUCT });
    expect(db.argsOf('from')).toEqual(['products']);
    expect(db.allOf('eq')).toEqual([['id', PRODUCT], ['artisan_id', ARTISAN]]);
    expect(db.allOf('is')).toContainEqual(['deleted_at', null]);
  });

  it('can include a deleted product, which restoring needs to find', async () => {
    db.answer({ data: { id: PRODUCT, deleted_at: '2026-11-13T10:00:00Z' } });
    await getOwnedProduct(ARTISAN, PRODUCT, { includeDeleted: true });
    expect(db.allOf('is')).toEqual([]);
  });

  it('is null for a product that is not theirs or does not exist (the two look the same)', async () => {
    db.answer({ data: null });
    await expect(getOwnedProduct(ARTISAN, PRODUCT)).resolves.toBeNull();
  });

  it('does not hide a real database failure as "not found"', async () => {
    db.answer({ error: { code: '08006', message: 'connection failure' } });
    await expect(getOwnedProduct(ARTISAN, PRODUCT)).rejects.toThrow(/connection failure/);
  });
});

describe('requireOwnedProduct', () => {
  it('returns the product when it is the caller\'s', async () => {
    db.answer({ data: { id: PRODUCT } });
    await expect(requireOwnedProduct(ARTISAN, PRODUCT)).resolves.toMatchObject({ id: PRODUCT });
  });

  it('throws a not_found ProductError when it is not', async () => {
    db.answer({ data: null });
    const error = await requireOwnedProduct(ARTISAN, PRODUCT).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ProductError);
    expect(error).toMatchObject({ code: 'not_found' });
  });
});

describe('productPatchSchema', () => {
  it('accepts a partial change and trims text', () => {
    expect(productPatchSchema.parse({ title_en: '  Blue Pot  ' })).toEqual({ title_en: 'Blue Pot' });
  });

  it('REFUSES stock: stock belongs to the inventory ledger, not to product edit', () => {
    expect(productPatchSchema.safeParse({ title_en: 'x', stock_quantity: 99 }).success).toBe(false);
  });

  it.each(['artisan_id', 'id', 'sku', 'raw_image_url', 'deleted_at', 'marketplace_sync_status'])(
    'refuses to change %s through an edit',
    (field) => {
      expect(productPatchSchema.safeParse({ title_en: 'x', [field]: 'whatever' }).success).toBe(false);
    },
  );

  it('refuses an empty change', () => {
    expect(productPatchSchema.safeParse({}).success).toBe(false);
    expect(productPatchSchema.safeParse({ dimensions_cm: {} }).success).toBe(false);
  });

  it('keeps one spelling of each tag (trimmed, lower-cased, no repeats)', () => {
    expect(productPatchSchema.parse({ seo_tags: ['Silk', ' silk ', 'SAREE', 'saree', 'cotton'] }).seo_tags).toEqual(['silk', 'saree', 'cotton']);
  });

  it.each([
    [{ title_en: '' }, 'an empty title'],
    [{ title_en: 'x'.repeat(201) }, 'a title over 200 characters'],
    [{ description_en: 'x'.repeat(5001) }, 'a description over 5000 characters'],
    [{ recommended_retail_inr: 0 }, 'a zero price'],
    [{ recommended_wholesale_inr: -5 }, 'a negative price'],
    [{ recommended_retail_inr: 10_000_001 }, 'a price too big for the column'],
    [{ min_wholesale_qty: 0 }, 'a minimum quantity of zero'],
    [{ min_wholesale_qty: 2.5 }, 'a fractional minimum quantity'],
    [{ labor_hours: 1001 }, 'more than 1000 labour hours'],
    [{ dimensions_cm: { length: 0 } }, 'a zero length'],
    [{ seo_tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }, 'more than 30 tags'],
    [{ seo_tags: ['x'.repeat(41)] }, 'a tag over 40 characters'],
  ])('rejects %j (%s)', (body, _why) => {
    expect(productPatchSchema.safeParse(body).success).toBe(false);
  });

  it('allows clearing the HSN code with null', () => {
    expect(productPatchSchema.parse({ hsn_code: null })).toEqual({ hsn_code: null });
  });
});

describe('updateProduct', () => {
  const existing = {
    id: PRODUCT,
    artisan_id: ARTISAN,
    recommended_retail_inr: '1000.00', // numeric columns arrive as strings
    recommended_wholesale_inr: '700.00',
    dimensions_cm: { length: 20, width: 10, height: 5 },
  };

  it('changes only what was sent, scoped to the artisan, and stamps updated_at', async () => {
    db.answer({ data: existing }, { data: { ...existing, title_en: 'New' } });
    const product = await updateProduct(ARTISAN, PRODUCT, { title_en: 'New' });

    expect(product).toMatchObject({ title_en: 'New' });
    const [row] = db.argsOf('update') as [Record<string, unknown>];
    expect(Object.keys(row).sort()).toEqual(['title_en', 'updated_at']);
    // the write is filtered by id AND owner, and refuses a product deleted in the meantime
    expect(db.allOf('eq').slice(-2)).toEqual([['id', PRODUCT], ['artisan_id', ARTISAN]]);
    expect(db.allOf('is').at(-1)).toEqual(['deleted_at', null]);
  });

  it('merges measurements into the existing ones instead of replacing them', async () => {
    db.answer({ data: existing }, { data: existing });
    await updateProduct(ARTISAN, PRODUCT, { dimensions_cm: { length: 30 } });
    const [row] = db.argsOf('update') as [Record<string, unknown>];
    expect(row.dimensions_cm).toEqual({ length: 30, width: 10, height: 5 });
  });

  it('refuses a retail price at or below wholesale, comparing with what the product will END UP with', async () => {
    // only retail is sent, and it is below the stored wholesale of 700
    db.answer({ data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { recommended_retail_inr: 650 })).rejects.toMatchObject({ code: 'invalid' });
    expect(db.argsOf('update')).toBeUndefined();

    // only wholesale is sent, and it is above the stored retail of 1000
    db.reset();
    db.answer({ data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { recommended_wholesale_inr: 1000 })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('accepts a price change that keeps retail above wholesale', async () => {
    db.answer({ data: existing }, { data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { recommended_retail_inr: 1200, recommended_wholesale_inr: 800 })).resolves.toBeDefined();
  });

  it('does not compare prices when neither is being changed', async () => {
    // an old product whose stored prices break the rule can still have its title fixed
    db.answer({ data: { ...existing, recommended_retail_inr: '500.00', recommended_wholesale_inr: '600.00' } }, { data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { title_en: 'Fixed' })).resolves.toBeDefined();
  });

  it('is not_found for a product that is not the caller\'s, without writing anything', async () => {
    db.answer({ data: null });
    await expect(updateProduct(ARTISAN, PRODUCT, { title_en: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('is not_found if the product was deleted between reading it and writing', async () => {
    db.answer({ data: existing }, { data: null });
    await expect(updateProduct(ARTISAN, PRODUCT, { title_en: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not hide a database failure', async () => {
    db.answer({ data: existing }, { error: { code: '08006', message: 'connection failure' } });
    await expect(updateProduct(ARTISAN, PRODUCT, { title_en: 'x' })).rejects.toThrow(/connection failure/);
  });
});

/* ----------------------------------------------------------------- photos */

const url = (name: string, artisan = ARTISAN, folder = 'enhanced') =>
  `${process.env.SUPABASE_URL}/storage/v1/object/public/kalasetu-media/${artisan}/${folder}/${name}.jpg`;
const [COVER, A, B, C] = [url('cover'), url('a'), url('b'), url('c')];

describe('planPhotos', () => {
  const state = { enhanced_image_url: COVER, gallery_image_urls: [A, B, C] };

  it('changes nothing when asked for nothing', () => {
    expect(planPhotos(state, {})).toEqual({ enhanced_image_url: COVER, gallery_image_urls: [A, B, C], removed: [] });
  });

  it('reorders the extras', () => {
    expect(planPhotos(state, { gallery_image_urls: [C, A, B] })).toMatchObject({ gallery_image_urls: [C, A, B], removed: [] });
  });

  it('removes any extra left out of the list', () => {
    expect(planPhotos(state, { gallery_image_urls: [B] })).toEqual({ enhanced_image_url: COVER, gallery_image_urls: [B], removed: [A, C] });
  });

  it('can remove every extra', () => {
    expect(planPhotos(state, { gallery_image_urls: [] })).toMatchObject({ gallery_image_urls: [], removed: [A, B, C] });
  });

  it('promotes an extra to the cover, and the old cover takes its place, so no photo is lost', () => {
    expect(planPhotos(state, { cover_image_url: B })).toEqual({ enhanced_image_url: B, gallery_image_urls: [A, COVER, C], removed: [] });
  });

  it('promoting the photo that is already the cover is a no-op', () => {
    expect(planPhotos(state, { cover_image_url: COVER })).toMatchObject({ enhanced_image_url: COVER, gallery_image_urls: [A, B, C] });
  });

  it('can reorder and promote in one request', () => {
    // reorder to [C, A, B], then promote A: A becomes the cover, the old cover goes where A was
    expect(planPhotos(state, { gallery_image_urls: [C, A, B], cover_image_url: A })).toEqual({
      enhanced_image_url: A,
      gallery_image_urls: [C, COVER, B],
      removed: [],
    });
  });

  it('can remove one photo and promote another in one request', () => {
    expect(planPhotos(state, { gallery_image_urls: [A, B], cover_image_url: B })).toEqual({
      enhanced_image_url: B,
      gallery_image_urls: [A, COVER],
      removed: [C],
    });
  });

  it('refuses a photo the product does not already have (an edit cannot introduce URLs)', () => {
    const foreign = url('theirs', '99999999-0000-0000-0000-000000000009');
    expect(() => planPhotos(state, { gallery_image_urls: [A, foreign] })).toThrow(ProductError);
    expect(() => planPhotos(state, { cover_image_url: foreign })).toThrow(ProductError);
  });

  it('refuses to promote a photo that was removed in the same request', () => {
    expect(() => planPhotos(state, { gallery_image_urls: [A], cover_image_url: B })).toThrow(/extra photos/);
  });

  it('refuses a photo listed twice', () => {
    expect(() => planPhotos(state, { gallery_image_urls: [A, A] })).toThrow(/twice/);
  });

  it('copes with a product from before extra photos existed (no gallery at all)', () => {
    expect(planPhotos({ enhanced_image_url: COVER }, {})).toEqual({ enhanced_image_url: COVER, gallery_image_urls: [], removed: [] });
    expect(planPhotos({ enhanced_image_url: COVER, gallery_image_urls: null }, { gallery_image_urls: [] }).removed).toEqual([]);
    expect(() => planPhotos({ enhanced_image_url: COVER }, { cover_image_url: A })).toThrow(ProductError);
  });

  it('does not repeat the cover inside the extras it returns', () => {
    expect(planPhotos({ enhanced_image_url: COVER, gallery_image_urls: [COVER, A] }, {}).gallery_image_urls).toEqual([A]);
  });
});

describe('updateProduct with photos', () => {
  const existing = {
    id: PRODUCT,
    artisan_id: ARTISAN,
    enhanced_image_url: COVER,
    gallery_image_urls: [A, B, C],
    recommended_retail_inr: '1000.00',
    recommended_wholesale_inr: '700.00',
    dimensions_cm: { length: 1, width: 1, height: 1 },
  };

  it('saves the new cover and order, and deletes only the photos that left', async () => {
    db.answer({ data: existing }, { data: existing });
    await updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [B, A], cover_image_url: A });

    const [row] = db.argsOf('update') as [Record<string, unknown>];
    expect(row.enhanced_image_url).toBe(A);
    expect(row.gallery_image_urls).toEqual([B, COVER]);
    // C was left out, so C (and only C) is removed from storage, by its storage path
    expect(removeMedia).toHaveBeenCalledOnce();
    expect(removeMedia).toHaveBeenCalledWith([`${ARTISAN}/enhanced/c.jpg`]);
  });

  it('does not touch storage when no photo left the product', async () => {
    db.answer({ data: existing }, { data: existing });
    await updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [C, B, A] });
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it('does not write the gallery column at all when the list is unchanged', async () => {
    db.answer({ data: existing }, { data: existing });
    await updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [A, B, C], title_en: 'Renamed' });
    const [row] = db.argsOf('update') as [Record<string, unknown>];
    expect(row).not.toHaveProperty('gallery_image_urls');
    expect(row).not.toHaveProperty('enhanced_image_url');
  });

  it('deletes nothing from storage if the product could not be saved', async () => {
    db.answer({ data: existing }, { error: { code: '08006', message: 'connection failure' } });
    await expect(updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [A] })).rejects.toThrow();
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it('still succeeds if cleaning up storage fails (a leftover file is cheaper than a failed edit)', async () => {
    removeMedia.mockRejectedValue(new Error('storage down'));
    db.answer({ data: existing }, { data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [A] })).resolves.toBeDefined();
  });

  it('is a 400-style error, with nothing written, for a photo the product does not have', async () => {
    db.answer({ data: existing });
    await expect(updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [url('stranger')] })).rejects.toMatchObject({ code: 'invalid' });
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('never deletes another artisan\'s file even if a stored URL pointed at one', async () => {
    const theirs = url('theirs', '99999999-0000-0000-0000-000000000009');
    db.answer({ data: { ...existing, gallery_image_urls: [A, theirs] } }, { data: existing });
    await updateProduct(ARTISAN, PRODUCT, { gallery_image_urls: [A] });
    expect(removeMedia).not.toHaveBeenCalled(); // the ownership check refuses a path outside the caller's folder
  });
});

describe('productPatchSchema photo fields', () => {
  it('accepts a cover and a gallery list of at most 5 URLs', () => {
    expect(productPatchSchema.safeParse({ cover_image_url: A, gallery_image_urls: [B, C] }).success).toBe(true);
  });

  it('rejects more than 5 extras, and anything that is not a URL', () => {
    expect(productPatchSchema.safeParse({ gallery_image_urls: Array.from({ length: 6 }, (_, i) => url(`p${i}`)) }).success).toBe(false);
    expect(productPatchSchema.safeParse({ cover_image_url: 'not a url' }).success).toBe(false);
  });
});

/* ------------------------------------------------------- delete and restore */

describe('softDeleteProduct', () => {
  it('hides the product by stamping deleted_at, and removes nothing', async () => {
    db.answer({ data: { id: PRODUCT, deleted_at: '2026-11-13T10:00:00.000Z' } });
    const result = await softDeleteProduct(ARTISAN, PRODUCT);

    expect(result).toEqual({ id: PRODUCT, deleted_at: '2026-11-13T10:00:00.000Z' });
    const [row] = db.argsOf('update') as [Record<string, unknown>];
    expect(typeof row.deleted_at).toBe('string');
    expect(db.argsOf('delete')).toBeUndefined(); // soft: the row, photos and price history stay
    expect(db.allOf('eq')).toEqual([['id', PRODUCT], ['artisan_id', ARTISAN]]);
  });

  it('only touches a product that is not already deleted', async () => {
    db.answer({ data: { id: PRODUCT, deleted_at: 'x' } });
    await softDeleteProduct(ARTISAN, PRODUCT);
    expect(db.allOf('is')).toContainEqual(['deleted_at', null]);
  });

  it('is not_found for someone else\'s product, a missing one, or one already deleted', async () => {
    db.answer({ data: null });
    await expect(softDeleteProduct(ARTISAN, PRODUCT)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not hide a database failure', async () => {
    db.answer({ error: { code: '08006', message: 'connection failure' } });
    await expect(softDeleteProduct(ARTISAN, PRODUCT)).rejects.toThrow(/connection failure/);
  });
});

describe('restoreProduct', () => {
  it('clears deleted_at and returns the product', async () => {
    db.answer({ data: { id: PRODUCT, deleted_at: null } });
    const product = await restoreProduct(ARTISAN, PRODUCT);

    expect(product).toMatchObject({ id: PRODUCT, deleted_at: null });
    expect((db.argsOf('update') as [Record<string, unknown>])[0].deleted_at).toBeNull();
    expect(db.allOf('eq')).toEqual([['id', PRODUCT], ['artisan_id', ARTISAN]]);
  });

  it('only restores a product that IS deleted (restoring a live one is "not found", not a silent success)', async () => {
    db.answer({ data: { id: PRODUCT } });
    await restoreProduct(ARTISAN, PRODUCT);
    expect(db.allOf('not')).toContainEqual(['deleted_at', 'is', null]);
  });

  it('is not_found for someone else\'s product or one that is not deleted', async () => {
    db.answer({ data: null });
    await expect(restoreProduct(ARTISAN, PRODUCT)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not hide a database failure', async () => {
    db.answer({ error: { code: '08006', message: 'connection failure' } });
    await expect(restoreProduct(ARTISAN, PRODUCT)).rejects.toThrow(/connection failure/);
  });
});
