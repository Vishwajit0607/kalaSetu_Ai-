import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type KeyLike } from 'jose';
import { setKeyResolverForTests } from '../services/auth.service.js';
import {
  sanitizeSearch,
  searchFilter,
  searchWords,
  toPublicListing,
  type ListingRow,
} from '../services/listings.service.js';

/**
 * The bazaar shows one artisan's products to another. Two things must hold:
 * other people's *private* fields never leave the server, and free-text search
 * can't rewrite the query it is spliced into.
 */

/* ------------------------------------------------------------ fake Supabase */

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  result: { data: null as unknown, error: null as unknown, count: null as number | null },
}));

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();

  // Every chained method records itself and returns the builder; awaiting the
  // builder (or calling maybeSingle) resolves to the canned result.
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => Promise.resolve(db.result).then(resolve);
        }
        return (...args: unknown[]) => {
          db.calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );

  return {
    ...original,
    supabase: () => ({
      from: (table: string) => {
        db.calls.push(['from', [table]]);
        return builder;
      },
    }),
  };
});

import { buildServer } from '../index.js';

const ME = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const LISTING_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function row(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: LISTING_ID,
    artisan_id: OTHER,
    sku: 'KS-BAN-7F3A21',
    enhanced_image_url: 'https://cdn.example/enhanced.png',
    title_en: 'Banarasi Silk Saree',
    title_hi: 'बनारसी सिल्क साड़ी',
    description_en: 'Handwoven.',
    description_hi: 'हाथ से बुनी।',
    seo_tags: ['silk', 'saree'],
    hsn_code: '5007',
    dimensions_cm: { length: 550, width: 110, height: 2 },
    recommended_retail_inr: '12400.00',
    recommended_wholesale_inr: 8900,
    min_wholesale_qty: 5,
    stock_quantity: 4,
    updated_at: '2026-11-12T10:00:00.000Z',
    artisans: {
      id: OTHER,
      full_name: 'Sunita Devi',
      craft_category: 'Banarasi silk',
      cluster_location: 'Varanasi',
      gi_tag_certified: true,
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------ projection */

describe('toPublicListing', () => {
  it('never carries cost, labour, raw media, transcript or phone', () => {
    // The database row, as the service-role client would really return it:
    // far more than a listing should show.
    const dirty = {
      ...row(),
      material_cost_inr: 3200,
      labor_hours: 40,
      raw_image_url: 'https://cdn.example/raw.jpg',
      voice_note_url: 'https://cdn.example/voice.wav',
      native_transcript: 'मेरा नंबर 98765',
      marketplace_sync_status: { ondc: true, gem: false, b2b: false },
      artisans: { ...row().artisans, phone_number: '+919876543210' },
    } as unknown as ListingRow;

    const listing = toPublicListing(dirty, ME);
    const json = JSON.stringify(listing);

    for (const secret of [
      'material_cost',
      'labor_hours',
      'raw_image_url',
      'voice_note_url',
      'native_transcript',
      'marketplace_sync_status',
      'phone',
      '9876543210',
      '3200',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('lists the extra photos after the cover, without repeating it', () => {
    const listing = toPublicListing(
      row({ gallery_image_urls: ['https://cdn.example/side.jpg', row().enhanced_image_url] }),
      ME,
    );
    expect(listing?.gallery_image_urls).toEqual(['https://cdn.example/side.jpg']);
  });

  it('gives an empty gallery for a product without extras or from before the migration', () => {
    expect(toPublicListing(row(), ME)?.gallery_image_urls).toEqual([]);
    expect(toPublicListing(row({ gallery_image_urls: null }), ME)?.gallery_image_urls).toEqual([]);
  });

  it('exposes exactly the allowlisted fields', () => {
    const listing = toPublicListing(row(), ME);
    expect(Object.keys(listing ?? {}).sort()).toEqual(
      [
        'id', 'sku', 'enhanced_image_url', 'gallery_image_urls', 'title_en', 'title_hi', 'description_en',
        'description_hi', 'seo_tags', 'hsn_code', 'dimensions_cm', 'recommended_retail_inr',
        'recommended_wholesale_inr', 'min_wholesale_qty', 'stock_quantity', 'updated_at',
        'is_mine', 'seller',
      ].sort(),
    );
    expect(Object.keys(listing?.seller ?? {}).sort()).toEqual(
      ['id', 'full_name', 'craft_category', 'cluster_location', 'gi_tag_certified'].sort(),
    );
  });

  it('flags the viewer\'s own products and nobody else\'s', () => {
    expect(toPublicListing(row({ artisan_id: ME }), ME)?.is_mine).toBe(true);
    expect(toPublicListing(row({ artisan_id: OTHER }), ME)?.is_mine).toBe(false);
    expect(toPublicListing(row(), null)?.is_mine).toBe(false);
  });

  it('turns NUMERIC strings into numbers and a null tag list into []', () => {
    const listing = toPublicListing(row({ seo_tags: null }), ME);
    expect(listing?.recommended_retail_inr).toBe(12400);
    expect(listing?.recommended_wholesale_inr).toBe(8900);
    expect(listing?.seo_tags).toEqual([]);
  });

  it('drops a row whose seller is missing rather than showing it anonymous', () => {
    expect(toPublicListing(row({ artisans: null }), ME)).toBeNull();
  });
});

/* ------------------------------------------------------------ search input */

describe('sanitizeSearch', () => {
  it('neutralises the characters that are syntax in a PostgREST or() filter', () => {
    const hostile = sanitizeSearch('silk),artisan_id.eq.1,title_en.ilike.(%');
    expect(hostile).not.toMatch(/[%_,()*:\\\\"\'{}]/);
  });

  it('keeps both words of "silk,saree" instead of gluing them', () => {
    expect(sanitizeSearch('silk,saree')).toBe('silk saree');
  });

  it('keeps Devanagari intact', () => {
    expect(sanitizeSearch('  बनारसी   साड़ी ')).toBe('बनारसी साड़ी');
  });

  it('caps length and handles empty input', () => {
    expect(sanitizeSearch('x'.repeat(500))).toHaveLength(60);
    expect(sanitizeSearch(undefined)).toBe('');
    expect(sanitizeSearch('%%__')).toBe('');
  });
});

describe('searchWords', () => {
  it('splits into independent words', () => {
    expect(searchWords('saree  silk')).toEqual(['saree', 'silk']);
  });

  it('caps the number of words so one request cannot build a huge filter', () => {
    expect(searchWords('a1 b2 c3 d4 e5 f6 g7')).toHaveLength(4);
  });

  it('returns nothing for empty or all-punctuation input', () => {
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords('  ,, % ')).toEqual([]);
  });

  it('cannot smuggle a clause on another column through any word', () => {
    // A comma is the clause separator: if one survived into a word it would
    // start a clause on a column we never chose. Every clause must be ours.
    for (const word of searchWords('silk),artisan_id.eq.1,title_en.ilike.(%')) {
      for (const clause of searchFilter(word).split(',')) {
        expect(clause).toMatch(/^(title_en|title_hi|sku)\.ilike\.|^seo_tags\.cs\./);
      }
    }
  });
});

describe('searchFilter', () => {
  it('matches a word in either title, the SKU, or as an exact tag', () => {
    const filter = searchFilter('Silk');
    expect(filter).toContain('title_en.ilike.%Silk%');
    expect(filter).toContain('title_hi.ilike.%Silk%');
    expect(filter).toContain('sku.ilike.%Silk%');
    expect(filter).toContain('seo_tags.cs.{silk}');
  });
});

/* ------------------------------------------------------------------ routes */

let privateKey: KeyLike;

async function tokenFor(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(sub)
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  setKeyResolverForTests(createLocalJWKSet({ keys: [jwk] }));
});

afterAll(() => setKeyResolverForTests(null));

beforeEach(() => {
  db.calls = [];
  db.result = { data: null, error: null, count: null };
});

const called = (name: string) => db.calls.filter(([method]) => method === name);

describe('GET /v1/marketplace/listings', () => {
  async function get(url: string, sub = ME) {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${await tokenFor(sub)}` },
    });
    await app.close();
    return res;
  }

  it('returns other artisans\' products with a stripped, flagged projection', async () => {
    db.result = {
      data: [row({ artisan_id: OTHER }), row({ id: 'b', artisan_id: ME })],
      error: null,
      count: 2,
    };

    const res = await get('/v1/marketplace/listings');
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.listings.map((l: { is_mine: boolean }) => l.is_mine)).toEqual([false, true]);
    expect(body.total).toBe(2);
    expect(body.has_more).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/material_cost|labor_hours|phone/);
  });

  it('is not scoped to the caller - there is no artisan_id filter at all', async () => {
    db.result = { data: [], error: null, count: 0 };
    await get('/v1/marketplace/listings');

    const filtersByArtisan = db.calls.filter(
      ([method, args]) => method === 'eq' && String(args[0]).includes('artisan_id'),
    );
    expect(filtersByArtisan).toEqual([]);
    // ...but soft-deleted products are always excluded.
    expect(called('is')[0]?.[1]).toEqual(['deleted_at', null]);
  });

  it('pages with range() and reports has_more from the total', async () => {
    db.result = { data: [row(), row({ id: 'c' })], error: null, count: 7 };
    const res = await get('/v1/marketplace/listings?limit=2&offset=4');

    expect(called('range')[0]?.[1]).toEqual([4, 5]);
    expect(res.json()).toMatchObject({ offset: 4, total: 7, has_more: true });
  });

  it('applies a craft filter to the joined seller and a sanitised search', async () => {
    db.result = { data: [], error: null, count: 0 };
    await get(`/v1/marketplace/listings?craft=${encodeURIComponent('Banarasi silk')}&q=${encodeURIComponent('silk),x')}`);

    expect(called('eq')).toContainEqual(['eq', ['artisans.craft_category', 'Banarasi silk']]);
    // "silk),x" becomes two words, each its own AND-ed or() group.
    const groups = called('or').map(([, args]) => String(args[0]));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain('title_en.ilike.%silk%');
    expect(groups[1]).toContain('title_en.ilike.%x%');
    expect(groups.join('')).not.toContain(')');
  });

  it.each([
    ['limit above the cap', '?limit=500'],
    ['negative offset', '?offset=-1'],
    ['non-numeric limit', '?limit=abc'],
  ])('rejects %s with a 400', async (_label, qs) => {
    expect((await get(`/v1/marketplace/listings${qs}`)).statusCode).toBe(400);
  });

  it('surfaces a database error as a 500, not an empty marketplace', async () => {
    db.result = { data: null, error: { message: 'boom' }, count: null };
    expect((await get('/v1/marketplace/listings')).statusCode).toBe(500);
  });
});

describe('GET /v1/marketplace/listings/:id', () => {
  async function get(id: string) {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/marketplace/listings/${id}`,
      headers: { authorization: `Bearer ${await tokenFor(ME)}` },
    });
    await app.close();
    return res;
  }

  it('returns one listing', async () => {
    db.result = { data: row(), error: null, count: null };
    const res = await get(LISTING_ID);
    expect(res.statusCode).toBe(200);
    expect(res.json().listing).toMatchObject({ id: LISTING_ID, is_mine: false });
  });

  it('404s for a missing or deleted product', async () => {
    db.result = { data: null, error: null, count: null };
    expect((await get(LISTING_ID)).statusCode).toBe(404);
  });

  it('400s on a malformed id before touching the database', async () => {
    expect((await get('not-a-uuid')).statusCode).toBe(400);
    expect(db.calls).toEqual([]);
  });
});

describe('GET /v1/marketplace/crafts', () => {
  it('counts products per craft, most common first', async () => {
    db.result = {
      data: [
        { artisans: { craft_category: 'Pottery' } },
        { artisans: { craft_category: 'Banarasi silk' } },
        { artisans: { craft_category: 'Banarasi silk' } },
        { artisans: null },
      ],
      error: null,
      count: null,
    };

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/crafts',
      headers: { authorization: `Bearer ${await tokenFor(ME)}` },
    });
    await app.close();

    expect(res.json().crafts).toEqual([
      { name: 'Banarasi silk', count: 2 },
      { name: 'Pottery', count: 1 },
    ]);
  });
});

describe('queryListings', () => {
  it('asks for the gallery column, and goes without it when the database has none', async () => {
    const { queryListings, LISTING_SELECT } = await import('../services/listings.service.js');
    const seen: string[] = [];
    const result = await queryListings(async (select) => {
      seen.push(select);
      return select.includes('gallery_image_urls')
        ? { error: { message: 'column products.gallery_image_urls does not exist' }, data: null }
        : { error: null, data: ['row'] };
    });
    expect(result.data).toEqual(['row']);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('gallery_image_urls');
    expect(seen[1]).toBe(LISTING_SELECT);
  });

  it('does not hide an unrelated error', async () => {
    const { queryListings } = await import('../services/listings.service.js');
    const result = await queryListings(async () => ({ error: { message: 'connection reset' }, data: null }));
    expect(result.error?.message).toBe('connection reset');
  });
});
