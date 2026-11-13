import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';

const translateText = vi.hoisted(() => vi.fn());

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});
vi.mock('../services/sarvam.service.js', () => ({ translateText }));

import { UpstreamError } from '../services/http.js';
import { TRANSLATE_CHUNK, retranslateProduct, splitForTranslation } from '../services/product.service.js';

const ARTISAN = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODUCT = '11111111-0000-0000-0000-000000000001';

const product = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  artisan_id: ARTISAN,
  title_en: 'Blue Pot',
  title_hi: 'old hi title',
  description_en: 'A handmade pot.',
  description_hi: 'old hi description',
  recommended_retail_inr: '1000.00',
  recommended_wholesale_inr: '700.00',
  dimensions_cm: { length: 1, width: 1, height: 1 },
  ...over,
});

/** A translator that tags its output so a test can see which language each piece went to. */
const fakeTranslator = () =>
  translateText.mockImplementation(async ({ text, targetLanguageCode }: { text: string; targetLanguageCode: string }) => ({
    text: `[${targetLanguageCode}] ${text}`,
  }));

beforeEach(() => {
  db.reset();
  translateText.mockReset();
  fakeTranslator();
});

describe('splitForTranslation', () => {
  it('leaves short text in one piece, and gives nothing for blank text', () => {
    expect(splitForTranslation('Hello world.')).toEqual(['Hello world.']);
    expect(splitForTranslation('   ')).toEqual([]);
  });

  it('splits long text between sentences, never above the limit', () => {
    const sentence = 'This is one sentence about a handmade pot. ';
    const text = sentence.repeat(80).trim(); // ~3400 characters
    const chunks = splitForTranslation(text);

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
    // every chunk ends at a sentence boundary
    for (const chunk of chunks) expect(chunk.endsWith('.')).toBe(true);
    // nothing lost or reordered
    expect(chunks.join(' ')).toBe(text);
  });

  it('breaks on the Hindi danda and on new lines too', () => {
    const hindi = ('यह एक हाथ से बना मटका है। ').repeat(80).trim();
    const chunks = splitForTranslation(hindi);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
      expect(chunk.endsWith('\u0964')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(hindi);
  });

  it('breaks a single huge sentence at word boundaries', () => {
    const text = 'word '.repeat(600).trim(); // one 2999-character "sentence"
    const chunks = splitForTranslation(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
      expect(chunk).not.toMatch(/^\s|\s$|wor$|^d /); // no word cut in half
    }
    expect(chunks.join(' ')).toBe(text);
  });

  it('as a last resort cuts a word with no spaces at all, still within the limit', () => {
    const chunks = splitForTranslation('x'.repeat(2000));
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
    expect(chunks.join('')).toBe('x'.repeat(2000));
  });
});

describe('retranslateProduct', () => {
  it('previews by default: translates English into Hindi and changes NOTHING', async () => {
    db.answer({ data: product() });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: false });

    expect(result).toEqual({
      from: 'en-IN',
      to: 'hi-IN',
      translations: { title: '[hi-IN] Blue Pot', description: '[hi-IN] A handmade pot.' },
      applied: false,
      product: null,
    });
    expect(translateText).toHaveBeenCalledWith({ text: 'Blue Pot', sourceLanguageCode: 'en-IN', targetLanguageCode: 'hi-IN' });
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('translates the other way round, from Hindi into English', async () => {
    db.answer({ data: product({ title_hi: 'नीला मटका', description_hi: 'हाथ से बना।' }) });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'hi-IN', apply: false });
    expect(result.to).toBe('en-IN');
    expect(translateText).toHaveBeenCalledWith({ text: 'नीला मटका', sourceLanguageCode: 'hi-IN', targetLanguageCode: 'en-IN' });
  });

  it('applies when asked: writes only the OTHER language\'s fields, never the one translated from', async () => {
    db.answer({ data: product() }, { data: product() }, { data: product({ title_hi: '[hi-IN] Blue Pot' }) });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: true });

    expect(result.applied).toBe(true);
    const [written] = db.argsOf('update') as [Record<string, unknown>];
    expect(written.title_hi).toBe('[hi-IN] Blue Pot');
    expect(written.description_hi).toBe('[hi-IN] A handmade pot.');
    expect(written).not.toHaveProperty('title_en');
    expect(written).not.toHaveProperty('description_en');
  });

  it('skips a field with no source text instead of overwriting the other language with nothing', async () => {
    db.answer({ data: product({ description_en: '   ' }) });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: false });
    expect(result.translations).toEqual({ title: '[hi-IN] Blue Pot' });
    expect(translateText).toHaveBeenCalledTimes(1);
  });

  it('is an error, not a silent no-op, when there is nothing to translate', async () => {
    db.answer({ data: product({ title_en: '', description_en: '' }) });
    await expect(retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: true })).rejects.toMatchObject({ code: 'invalid' });
    expect(translateText).not.toHaveBeenCalled();
  });

  it('does not overwrite a field when the translator returns nothing for it', async () => {
    translateText.mockResolvedValue({ text: '' });
    db.answer({ data: product() });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: true });

    expect(result).toMatchObject({ translations: {}, applied: false, product: null });
    expect(db.argsOf('update')).toBeUndefined();
  });

  it('translates a long description in several pieces, in order, and re-joins them', async () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the pot.`);
    db.answer({ data: product({ description_en: sentences.join(' ') }) });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: false });

    const descriptionCalls = translateText.mock.calls.filter(([arg]) => arg.text !== 'Blue Pot');
    expect(descriptionCalls.length).toBeGreaterThan(1);
    for (const [arg] of descriptionCalls) expect(arg.text.length).toBeLessThanOrEqual(TRANSLATE_CHUNK);
    expect(result.translations.description).toContain('Sentence number 0');
    expect(result.translations.description!.indexOf('number 0')).toBeLessThan(result.translations.description!.indexOf('number 59'));
  });

  it('cuts a translation that comes back longer than the field allows', async () => {
    translateText.mockImplementation(async () => ({ text: 'x'.repeat(6000) }));
    db.answer({ data: product() });
    const result = await retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: false });
    expect(result.translations.title).toHaveLength(200);
    expect(result.translations.description).toHaveLength(5000);
  });

  it('is not_found for a product that is not the caller\'s, and never calls the translator', async () => {
    db.answer({ data: null });
    await expect(retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: true })).rejects.toMatchObject({ code: 'not_found' });
    expect(translateText).not.toHaveBeenCalled();
  });

  it('lets a translator outage through as an upstream error, having written nothing', async () => {
    translateText.mockRejectedValue(new UpstreamError('sarvam-translate', 503, 'down'));
    db.answer({ data: product() });
    await expect(retranslateProduct(ARTISAN, PRODUCT, { from: 'en-IN', apply: true })).rejects.toBeInstanceOf(UpstreamError);
    expect(db.argsOf('update')).toBeUndefined();
  });
});
