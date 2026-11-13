import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

const translateText = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase, removeMedia: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../services/sarvam.service.js', () => ({ translateText }));

import { UpstreamError } from '../services/http.js';
import { TRANSLATE_CHUNK, retranslateProduct } from '../services/product.service.js';

/**
 * Re-translation talks to a paid, sometimes slow, sometimes failing vendor (Sarvam, mocked
 * here). These tests pin down what happens when it misbehaves: a failure part-way must
 * never leave a half-translated product, calls are made one at a time, and the language
 * that was translated FROM is never touched.
 */

const PRODUCT = '11111111-0000-0000-0000-000000000001';
const url = `/v1/catalog/products/${PRODUCT}/retranslate`;

const product = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  artisan_id: ME,
  title_en: 'Blue Pot',
  title_hi: 'नीला मटका',
  description_en: 'A handmade pot.',
  description_hi: 'हाथ से बना मटका।',
  recommended_retail_inr: '1000.00',
  recommended_wholesale_inr: '700.00',
  dimensions_cm: { length: 1, width: 1, height: 1 },
  ...over,
});

const tagging = () =>
  translateText.mockImplementation(async ({ text, targetLanguageCode }: { text: string; targetLanguageCode: string }) => ({
    text: `[${targetLanguageCode}] ${text}`,
  }));

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => {
  db.reset();
  translateText.mockReset();
  tagging();
});

describe('a failure part-way through', () => {
  it('writes NOTHING when the title translated but the description failed', async () => {
    translateText
      .mockResolvedValueOnce({ text: 'ok title' })
      .mockRejectedValueOnce(new UpstreamError('sarvam-translate', 502, 'bad gateway'));
    db.answer({ data: product() });

    await expect(retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: true })).rejects.toBeInstanceOf(UpstreamError);
    expect(translateText).toHaveBeenCalledTimes(2);
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('writes NOTHING when a later piece of a long description fails', async () => {
    const sentence = 'Hand thrown on a wheel and fired. ';
    const long = sentence.repeat(Math.ceil((TRANSLATE_CHUNK * 3) / sentence.length)).trim();
    translateText
      .mockResolvedValueOnce({ text: 'title' })
      .mockResolvedValueOnce({ text: 'piece 1' })
      .mockRejectedValueOnce(new UpstreamError('sarvam-translate', 429, 'slow down'));
    db.answer({ data: product({ description_en: long }) });

    await expect(retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: true })).rejects.toMatchObject({ status: 429 });
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('stops calling the vendor after the first failure instead of spending the rest', async () => {
    translateText.mockRejectedValue(new UpstreamError('sarvam-translate', 503, 'down'));
    db.answer({ data: product() });
    await expect(retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: false })).rejects.toBeInstanceOf(UpstreamError);
    expect(translateText).toHaveBeenCalledTimes(1);
  });
});

describe('how the vendor is called', () => {
  it('makes one call at a time, never several in flight together', async () => {
    let inFlight = 0;
    let peak = 0;
    translateText.mockImplementation(async ({ text }: { text: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { text: `t:${text}` };
    });
    const sentence = 'One more sentence about the pot. ';
    db.answer({ data: product({ description_en: sentence.repeat(Math.ceil((TRANSLATE_CHUNK * 2.5) / sentence.length)).trim() }) });

    await retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: false });
    expect(translateText.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(peak).toBe(1);
  });

  it('translates the title first, then the description, in that order', async () => {
    db.answer({ data: product() });
    await retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: false });
    expect(translateText.mock.calls.map(([arg]) => arg.text)).toEqual(['Blue Pot', 'A handmade pot.']);
  });

  it('never sends more than one chunk-limit of text in a single call', async () => {
    const sentence = 'सुंदर हाथ से बना मटका। ';
    db.answer({ data: product({ description_hi: sentence.repeat(Math.ceil((TRANSLATE_CHUNK * 4) / sentence.length)).trim() }) });
    await retranslateProduct(ME, PRODUCT, { from: 'hi-IN', apply: false });
    for (const [arg] of translateText.mock.calls) expect(arg.text.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
  });
});

describe('what gets saved', () => {
  it('Hindi to English writes the English fields and leaves the Hindi ones alone', async () => {
    db.answer({ data: product() }, { data: product() }, { data: product({ title_en: '[en-IN] नीला मटका' }) });
    const result = await retranslateProduct(ME, PRODUCT, { from: 'hi-IN', apply: true });

    expect(result).toMatchObject({ from: 'hi-IN', to: 'en-IN', applied: true });
    const [written] = db.argsOf('update') as [Record<string, unknown>];
    const { updated_at: _stamp, ...columns } = written;
    expect(columns).toEqual({
      title_en: '[en-IN] नीला मटका',
      description_en: '[en-IN] हाथ से बना मटका।',
    });
  });

  it('when only a title exists, saves only the title', async () => {
    db.answer({ data: product({ description_en: null }) }, { data: product({ description_en: null }) }, { data: product() });
    await retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: true });
    const [written] = db.argsOf('update') as [Record<string, unknown>];
    expect(Object.keys(written).filter((k) => k !== 'updated_at')).toEqual(['title_hi']);
  });

  it('the save is scoped to the same artisan and ignores soft-deleted products', async () => {
    db.answer({ data: product() }, { data: product() }, { data: product() });
    await retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: true });
    const eqs = db.allOf('eq') as Array<[string, string]>;
    expect(eqs).toContainEqual(['artisan_id', ME]);
    expect(db.allOf('is')).toContainEqual(['deleted_at', null]);
  });

  it('a preview, however many times it is run, never writes', async () => {
    for (let i = 0; i < 3; i++) {
      db.answer({ data: product() });
      await retranslateProduct(ME, PRODUCT, { from: 'en-IN', apply: false });
    }
    expect(db.argsOf('update')).toBeUndefined();
  });
});

describe('POST /:id/retranslate when the vendor fails', () => {
  it('passes the vendor outage through as an error status and saves nothing', async () => {
    translateText.mockRejectedValue(new UpstreamError('sarvam-translate', 503, 'down'));
    db.answer({ data: product() });
    const res = await call('POST', url, { body: { from: 'en-IN', apply: true } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe('upstream_unavailable');
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('a successful preview returns both translations and applied false', async () => {
    db.answer({ data: product() });
    const res = await call('POST', url, { body: { from: 'en-IN' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      from: 'en-IN',
      to: 'hi-IN',
      applied: false,
      translations: { title: '[hi-IN] Blue Pot', description: '[hi-IN] A handmade pot.' },
    });
  });
});
