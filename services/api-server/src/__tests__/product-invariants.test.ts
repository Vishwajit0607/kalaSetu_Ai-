import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

const translateText = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase, removeMedia: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../services/sarvam.service.js', () => ({ translateText }));

import {
  ProductError,
  TRANSLATE_CHUNK,
  getOwnedProduct,
  listPriceHistory,
  planPhotos,
  restoreProduct,
  retranslateProduct,
  softDeleteProduct,
  splitForTranslation,
  updateProduct,
  withChanges,
} from '../services/product.service.js';

/**
 * Properties that must hold for EVERY input, not just the examples someone thought of.
 * The random generators use a fixed seed, so a failure reproduces exactly.
 */

function rng(seed: number) {
  // mulberry32: small, fast, deterministic
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(random: () => number, items: T[]): T => items[Math.floor(random() * items.length)]!;
const shuffle = <T>(random: () => number, items: T[]): T[] => [...items].sort(() => random() - 0.5);

describe('planPhotos invariants (500 random products and requests)', () => {
  const photo = (n: number) => `https://cdn.example/${n}.jpg`;

  it('never loses a photo, never invents one, never duplicates one, and never leaves the cover among the extras', () => {
    const random = rng(20261113);

    for (let round = 0; round < 500; round += 1) {
      const extras = Array.from({ length: Math.floor(random() * 6) }, (_, i) => photo(i + 1));
      const current = { enhanced_image_url: photo(0), gallery_image_urls: extras };
      const everything = [photo(0), ...extras];

      // a VALID request: some subset of the extras, reordered, and maybe a promotion from what is kept
      const kept = shuffle(random, extras.filter(() => random() < 0.7));
      const request: { gallery_image_urls?: string[]; cover_image_url?: string } = {};
      if (random() < 0.8) request.gallery_image_urls = kept;
      const pool = request.gallery_image_urls ?? extras;
      if (pool.length > 0 && random() < 0.5) request.cover_image_url = pick(random, pool);

      const plan = planPhotos(current, request);
      const after = [plan.enhanced_image_url, ...plan.gallery_image_urls];

      // 1. every photo is accounted for: still shown, or reported as removed - none vanish
      expect([...after, ...plan.removed].sort()).toEqual([...everything].sort());
      // 2. nothing is shown twice, and a removed photo is not also shown
      expect(new Set(after).size).toBe(after.length);
      for (const gone of plan.removed) expect(after).not.toContain(gone);
      // 3. the cover is never also an extra
      expect(plan.gallery_image_urls).not.toContain(plan.enhanced_image_url);
      // 4. only the requested photos survive; a promotion never grows or shrinks the set
      expect(after.length).toBe(1 + (request.gallery_image_urls ?? extras).length);
      // 5. never more than the allowed number of extras
      expect(plan.gallery_image_urls.length).toBeLessThanOrEqual(5);
    }
  });

  it('refuses, whatever else is in the request, any photo the product does not have', () => {
    const random = rng(7);
    for (let round = 0; round < 200; round += 1) {
      const extras = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => photo(i + 1));
      const stranger = `https://evil.example/${Math.floor(random() * 1e6)}.jpg`;
      const withStranger = shuffle(random, [...extras.filter(() => random() < 0.5), stranger]);

      expect(() => planPhotos({ enhanced_image_url: photo(0), gallery_image_urls: extras }, { gallery_image_urls: withStranger })).toThrow(ProductError);
      expect(() => planPhotos({ enhanced_image_url: photo(0), gallery_image_urls: extras }, { cover_image_url: stranger })).toThrow(ProductError);
    }
  });

  it('is idempotent: applying its own result again changes nothing', () => {
    const random = rng(99);
    for (let round = 0; round < 200; round += 1) {
      const extras = Array.from({ length: Math.floor(random() * 6) }, (_, i) => photo(i + 1));
      const plan = planPhotos({ enhanced_image_url: photo(0), gallery_image_urls: extras }, { gallery_image_urls: shuffle(random, extras) });
      const again = planPhotos(
        { enhanced_image_url: plan.enhanced_image_url, gallery_image_urls: plan.gallery_image_urls },
        { gallery_image_urls: plan.gallery_image_urls, cover_image_url: plan.enhanced_image_url },
      );
      expect(again).toEqual({ ...plan, removed: [] });
    }
  });
});

describe('withChanges invariants', () => {
  it('the changes add up exactly: their sum is newest price minus oldest price, to the paisa', () => {
    const random = rng(5);
    for (let round = 0; round < 200; round += 1) {
      const count = 2 + Math.floor(random() * 8);
      const rows = Array.from({ length: count }, (_, i) => ({
        id: `h${i}`,
        // prices in whole paise, as NUMERIC(10,2) holds them
        retail_inr: Math.round(random() * 1_000_000) / 100,
        wholesale_inr: Math.round(random() * 1_000_000) / 100,
        source: 'edit' as const,
        changed_at: String(count - i),
      }));

      const out = withChanges(rows);
      const sum = out.reduce((total, row) => total + (row.retail_change ?? 0), 0);
      expect(Math.round(sum * 100)).toBe(Math.round((rows[0]!.retail_inr - rows.at(-1)!.retail_inr) * 100));
      expect(out.at(-1)!.retail_change).toBeNull(); // the oldest has nothing to compare with
      expect(out.slice(0, -1).every((row) => row.retail_change !== null)).toBe(true);
    }
  });
});

describe('splitForTranslation invariants', () => {
  it('never exceeds the limit and never loses or reorders a word, for any text', () => {
    const random = rng(1234);
    const words = ['pot', 'handmade', 'blue', 'cotton', 'saree', 'कढ़ाई', 'मटका', 'brass', 'a', 'of'];

    for (let round = 0; round < 200; round += 1) {
      const text = Array.from({ length: 1 + Math.floor(random() * 900) }, () => {
        const word = pick(random, words);
        const r = random();
        return r < 0.08 ? `${word}.` : r < 0.12 ? `${word}।` : r < 0.14 ? `${word}\n` : word;
      }).join(' ');

      const chunks = splitForTranslation(text);
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
      // the same words, in the same order, once whitespace is ignored
      expect(chunks.join(' ').split(/\s+/)).toEqual(text.trim().split(/\s+/));
    }
  });
});

describe('every product operation is scoped to the artisan it is given', () => {
  const PRODUCT = '11111111-0000-0000-0000-000000000001';
  const owned = (artisan: string) => ({
    id: PRODUCT,
    artisan_id: artisan,
    title_en: 'Pot',
    title_hi: 'मटका',
    description_en: 'd',
    description_hi: 'd',
    enhanced_image_url: 'https://cdn.example/c.jpg',
    recommended_retail_inr: '1000.00',
    recommended_wholesale_inr: '700.00',
    dimensions_cm: { length: 1, width: 1, height: 1 },
  });

  const operations: Array<[string, (artisan: string) => Promise<unknown>, (artisan: string) => Array<Record<string, unknown>>]> = [
    ['getOwnedProduct', (a) => getOwnedProduct(a, PRODUCT), (a) => [{ data: owned(a) }]],
    ['updateProduct', (a) => updateProduct(a, PRODUCT, { title_en: 'New' }), (a) => [{ data: owned(a) }, { data: owned(a) }]],
    ['softDeleteProduct', (a) => softDeleteProduct(a, PRODUCT), () => [{ data: { id: PRODUCT, deleted_at: 'x' } }]],
    ['restoreProduct', (a) => restoreProduct(a, PRODUCT), (a) => [{ data: owned(a) }]],
    ['listPriceHistory', (a) => listPriceHistory(a, PRODUCT, { limit: 5 }), (a) => [{ data: owned(a) }, { data: [] }]],
    [
      'retranslateProduct',
      (a) => retranslateProduct(a, PRODUCT, { from: 'en-IN', apply: true }),
      (a) => [{ data: owned(a) }, { data: owned(a) }, { data: owned(a) }],
    ],
  ];

  beforeEach(() => {
    db.reset();
    translateText.mockReset().mockResolvedValue({ text: 'translated' });
  });

  it.each(operations)('%s filters by the artisan it was called for, whoever that is', async (_name, run, answers) => {
    for (const artisan of ['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000009']) {
      db.reset();
      db.answer(...(answers(artisan) as never[]));
      await run(artisan);

      const owners = (db.allOf('eq') as Array<[string, string]>).filter(([column]) => column === 'artisan_id');
      expect(owners.length).toBeGreaterThan(0);
      for (const [, value] of owners) expect(value).toBe(artisan);
    }
  });
});
