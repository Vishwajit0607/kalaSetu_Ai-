import {
  DESCRIPTION_MAX,
  DIMENSION_MAX,
  HSN_MAX,
  MIN_QTY_MAX,
  MONEY_MAX,
  TAGS_MAX,
  TAG_MAX,
  TITLE_MAX,
  changedProductFields,
  parseNumber,
  parseTags,
  validateProductForm,
  valuesFromProduct,
  type ProductFormValues,
} from '../services/productForm';
import { STRINGS } from '../i18n/strings';
import type { ProductRow } from '../services/apiClient';

const valid: ProductFormValues = {
  titleEn: 'Blue Pot',
  titleHi: 'नीला मटका',
  descriptionEn: 'A handmade pot.',
  descriptionHi: 'हाथ से बना मटका।',
  tags: 'pottery, blue',
  hsnCode: '6911',
  retail: '1000',
  wholesale: '700',
  minQty: '5',
  length: '20',
  width: '20',
  height: '25',
};

const saved = {
  id: 'p1',
  title_en: 'Blue Pot',
  title_hi: 'नीला मटका',
  description_en: 'A handmade pot.',
  description_hi: 'हाथ से बना मटका।',
  seo_tags: ['pottery', 'blue'],
  hsn_code: '6911',
  recommended_retail_inr: '1000.00',
  recommended_wholesale_inr: '700.00',
  min_wholesale_qty: 5,
  dimensions_cm: { length: 20, width: 20, height: 25 },
} as unknown as ProductRow;

const errorsOf = (over: Partial<ProductFormValues>) => {
  const result = validateProductForm({ ...valid, ...over });
  return result.ok ? null : result.errors;
};

describe('parseNumber', () => {
  it.each([
    ['1000', 1000],
    ['1,20,000', 120000],
    ['₹ 1,200.50', 1200.5],
    ['१२००', 1200],
    ['१,२०,०००.५', 120000.5],
    ['  7 ', 7],
    ['0', 0],
    ['.5', null],
    ['5.', null],
  ])('reads %p as %p', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });

  it.each(['', '  ', 'abc', '12abc', '1e3', '-5', '+5', '1.2.3', 'Infinity', 'NaN', '1/2'])('refuses %p', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
});

describe('parseTags', () => {
  it('splits on commas and new lines, trims, lower-cases and drops empties', () => {
    expect(parseTags(' Silk ,  Hand Woven,\n,saree ,')).toEqual(['silk', 'hand woven', 'saree']);
  });

  it('keeps one spelling of a tag, in first-seen order', () => {
    expect(parseTags('Silk, silk, SILK, cotton')).toEqual(['silk', 'cotton']);
  });

  it('gives nothing for blank text', () => {
    expect(parseTags('  , ,\n')).toEqual([]);
  });
});

describe('validateProductForm', () => {
  it('accepts a complete form and returns clean values', () => {
    expect(validateProductForm(valid)).toEqual({
      ok: true,
      values: {
        title_en: 'Blue Pot',
        title_hi: 'नीला मटका',
        description_en: 'A handmade pot.',
        description_hi: 'हाथ से बना मटका।',
        seo_tags: ['pottery', 'blue'],
        hsn_code: '6911',
        recommended_retail_inr: 1000,
        recommended_wholesale_inr: 700,
        min_wholesale_qty: 5,
        dimensions_cm: { length: 20, width: 20, height: 25 },
      },
    });
  });

  it('tidies titles, keeps line breaks in descriptions, and turns an emptied HSN into null', () => {
    const result = validateProductForm({ ...valid, titleEn: '  Blue   Pot ', descriptionEn: '\n Line one\nLine two \n', hsnCode: '  ' });
    expect(result).toMatchObject({
      ok: true,
      values: { title_en: 'Blue Pot', description_en: 'Line one\nLine two', hsn_code: null },
    });
  });

  it('allows an empty description, because the server allows one', () => {
    expect(validateProductForm({ ...valid, descriptionEn: '', descriptionHi: '' }).ok).toBe(true);
  });

  it('accepts typing in Hindi digits', () => {
    expect(validateProductForm({ ...valid, retail: '१२००', wholesale: '९००', minQty: '१०' })).toMatchObject({
      ok: true,
      values: { recommended_retail_inr: 1200, recommended_wholesale_inr: 900, min_wholesale_qty: 10 },
    });
  });

  it('rounds prices to paise, as the database stores them', () => {
    expect(validateProductForm({ ...valid, retail: '1000.456', wholesale: '700.004' })).toMatchObject({
      values: { recommended_retail_inr: 1000.46, recommended_wholesale_inr: 700 },
    });
  });

  describe('titles', () => {
    it('require both languages', () => {
      expect(errorsOf({ titleEn: '  ' })).toEqual({ titleEn: 'productForm.err.titleEn' });
      expect(errorsOf({ titleHi: '' })).toEqual({ titleHi: 'productForm.err.titleHi' });
    });

    it('allow exactly the maximum and refuse one more, counted after tidying', () => {
      expect(errorsOf({ titleEn: 'a'.repeat(TITLE_MAX) + '   ' })).toBeNull();
      expect(errorsOf({ titleEn: 'a'.repeat(TITLE_MAX + 1) })).toEqual({ titleEn: 'productForm.err.titleLong' });
      expect(errorsOf({ titleHi: 'क'.repeat(TITLE_MAX + 1) })).toEqual({ titleHi: 'productForm.err.titleLong' });
    });
  });

  describe('descriptions, tags and HSN', () => {
    it('limit the description', () => {
      expect(errorsOf({ descriptionEn: 'a'.repeat(DESCRIPTION_MAX) })).toBeNull();
      expect(errorsOf({ descriptionEn: 'a'.repeat(DESCRIPTION_MAX + 1) })).toEqual({ descriptionEn: 'productForm.err.descLong' });
      expect(errorsOf({ descriptionHi: 'क'.repeat(DESCRIPTION_MAX + 1) })).toEqual({ descriptionHi: 'productForm.err.descLong' });
    });

    it('limit the number of tags, counting a repeated tag once', () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`).join(',');
      expect(errorsOf({ tags: many(TAGS_MAX) })).toBeNull();
      expect(errorsOf({ tags: many(TAGS_MAX + 1) })).toEqual({ tags: 'productForm.err.tagsMany' });
      expect(errorsOf({ tags: `${many(TAGS_MAX)},TAG0,tag0` })).toBeNull();
    });

    it('limit the length of one tag', () => {
      expect(errorsOf({ tags: 'a'.repeat(TAG_MAX) })).toBeNull();
      expect(errorsOf({ tags: 'a'.repeat(TAG_MAX + 1) })).toEqual({ tags: 'productForm.err.tagLong' });
    });

    it('limit the HSN code', () => {
      expect(errorsOf({ hsnCode: '1'.repeat(HSN_MAX) })).toBeNull();
      expect(errorsOf({ hsnCode: '1'.repeat(HSN_MAX + 1) })).toEqual({ hsnCode: 'productForm.err.hsnLong' });
    });
  });

  describe('prices', () => {
    it('must be numbers', () => {
      expect(errorsOf({ retail: '' })).toEqual({ retail: 'productForm.err.number' });
      expect(errorsOf({ wholesale: 'abc' })).toEqual({ wholesale: 'productForm.err.number' });
    });

    it('must be more than zero, including after rounding to paise', () => {
      expect(errorsOf({ retail: '0' })).toEqual({ retail: 'productForm.err.priceZero' });
      expect(errorsOf({ wholesale: '0' })).toEqual({ wholesale: 'productForm.err.priceZero' });
      expect(errorsOf({ wholesale: '0.004' })).toEqual({ wholesale: 'productForm.err.priceZero' });
    });

    it('stop at the column limit', () => {
      expect(errorsOf({ retail: String(MONEY_MAX), wholesale: '700' })).toBeNull();
      expect(errorsOf({ retail: String(MONEY_MAX + 1) })).toEqual({ retail: 'productForm.err.priceHigh' });
    });

    it('require retail above wholesale, and equal is not above', () => {
      expect(errorsOf({ retail: '700', wholesale: '700' })).toEqual({ retail: 'productForm.err.retailBelow' });
      expect(errorsOf({ retail: '600', wholesale: '700' })).toEqual({ retail: 'productForm.err.retailBelow' });
      expect(errorsOf({ retail: '700.01', wholesale: '700' })).toBeNull();
    });

    it('compare after rounding, so two prices that round to the same paise are equal', () => {
      expect(errorsOf({ retail: '700.004', wholesale: '700.001' })).toEqual({ retail: 'productForm.err.retailBelow' });
    });

    it('do not report "retail below wholesale" while a price is itself wrong', () => {
      expect(errorsOf({ retail: 'abc', wholesale: '700' })).toEqual({ retail: 'productForm.err.number' });
      expect(errorsOf({ retail: '0', wholesale: '700' })).toEqual({ retail: 'productForm.err.priceZero' });
    });
  });

  describe('minimum quantity', () => {
    it('is a whole number from 1 to the limit', () => {
      expect(errorsOf({ minQty: '1' })).toBeNull();
      expect(errorsOf({ minQty: String(MIN_QTY_MAX) })).toBeNull();
      for (const bad of ['0', String(MIN_QTY_MAX + 1), '2.5']) {
        expect(errorsOf({ minQty: bad })).toEqual({ minQty: 'productForm.err.qtyRange' });
      }
      expect(errorsOf({ minQty: '' })).toEqual({ minQty: 'productForm.err.number' });
    });
  });

  describe('measurements', () => {
    it('must be numbers', () => {
      expect(errorsOf({ length: 'x', width: '', height: '-1' })).toEqual({
        length: 'productForm.err.number',
        width: 'productForm.err.number',
        height: 'productForm.err.number',
      });
    });

    it('may have a height of zero, but not a length or width of zero', () => {
      expect(errorsOf({ height: '0' })).toBeNull();
      expect(errorsOf({ length: '0' })).toEqual({ length: 'productForm.err.dimZero' });
      expect(errorsOf({ width: '0' })).toEqual({ width: 'productForm.err.dimZero' });
    });

    it('stop at the limit', () => {
      expect(errorsOf({ length: String(DIMENSION_MAX) })).toBeNull();
      expect(errorsOf({ length: String(DIMENSION_MAX + 1) })).toEqual({ length: 'productForm.err.dimHigh' });
    });
  });

  it('reports every problem at once, so the artisan fixes them in one go', () => {
    const errors = errorsOf({ titleEn: '', retail: 'abc', minQty: '0', length: '0' });
    expect(Object.keys(errors ?? {}).sort()).toEqual(['length', 'minQty', 'retail', 'titleEn']);
  });

  it('every error key has a sentence in both languages', () => {
    const keys = [
      'titleEn', 'titleHi', 'titleLong', 'descLong', 'tagsMany', 'tagLong', 'hsnLong',
      'number', 'priceZero', 'priceHigh', 'retailBelow', 'qtyRange', 'dimZero', 'dimHigh',
    ].map((name) => `productForm.err.${name}`);
    const missing = keys.flatMap((key) =>
      (['en', 'hi'] as const)
        .filter((lang) => ((STRINGS[lang] as Record<string, string>)[key]?.length ?? 0) === 0)
        .map((lang) => `${lang}:${key}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('valuesFromProduct', () => {
  it('shows database prices without a pointless ".00"', () => {
    expect(valuesFromProduct(saved)).toMatchObject({ retail: '1000', wholesale: '700', minQty: '5', length: '20' });
  });

  it('survives missing text and tags on an older product', () => {
    const sparse = { ...saved, description_en: undefined, seo_tags: undefined, hsn_code: null } as unknown as ProductRow;
    expect(valuesFromProduct(sparse)).toMatchObject({ descriptionEn: '', tags: '', hsnCode: '' });
  });

  it('round-trips: an untouched form validates and changes nothing', () => {
    const result = validateProductForm(valuesFromProduct(saved));
    expect(result.ok).toBe(true);
    if (result.ok) expect(changedProductFields(saved, result.values)).toEqual({});
  });
});

describe('changedProductFields', () => {
  const next = (over: Partial<ProductFormValues>) => {
    const result = validateProductForm({ ...valuesFromProduct(saved), ...over });
    if (!result.ok) throw new Error(`form should be valid: ${JSON.stringify(result.errors)}`);
    return changedProductFields(saved, result.values);
  };

  it('is empty when nothing changed', () => {
    expect(next({})).toEqual({});
  });

  it('sends only the field that changed', () => {
    expect(next({ titleEn: 'Red Pot' })).toEqual({ title_en: 'Red Pot' });
    expect(next({ retail: '1200' })).toEqual({ recommended_retail_inr: 1200 });
    expect(next({ minQty: '10' })).toEqual({ min_wholesale_qty: 10 });
  });

  it('sends only the measurement that changed', () => {
    expect(next({ width: '22' })).toEqual({ dimensions_cm: { width: 22 } });
    expect(next({ length: '21', height: '26' })).toEqual({ dimensions_cm: { length: 21, height: 26 } });
  });

  it('does not count whitespace-only edits as changes', () => {
    expect(next({ titleEn: '  Blue   Pot  ', descriptionEn: ' A handmade pot. ' })).toEqual({});
  });

  it('ignores the case and spacing of tags, but a different list or order is a change', () => {
    expect(next({ tags: 'Pottery,  BLUE' })).toEqual({});
    expect(next({ tags: 'blue, pottery' })).toEqual({ seo_tags: ['blue', 'pottery'] });
    expect(next({ tags: 'pottery' })).toEqual({ seo_tags: ['pottery'] });
    expect(next({ tags: '' })).toEqual({ seo_tags: [] });
  });

  it('sends null when the HSN code is cleared, and the code when it is set', () => {
    expect(next({ hsnCode: '' })).toEqual({ hsn_code: null });
    expect(next({ hsnCode: '6912' })).toEqual({ hsn_code: '6912' });
  });

  it('treats an unset HSN and an emptied box as the same thing', () => {
    const noHsn = { ...saved, hsn_code: null } as ProductRow;
    const result = validateProductForm({ ...valuesFromProduct(noHsn), hsnCode: '' });
    expect(result.ok && changedProductFields(noHsn, result.values)).toEqual({});
  });

  it('never includes stock, the owner, the SKU or the photos', () => {
    const everything = next({
      titleEn: 'x', titleHi: 'y', descriptionEn: 'z', descriptionHi: 'w', tags: 'q', hsnCode: '1',
      retail: '2000', wholesale: '1500', minQty: '2', length: '1', width: '1', height: '1',
    });
    for (const forbidden of ['stock_quantity', 'artisan_id', 'sku', 'deleted_at', 'cover_image_url', 'gallery_image_urls']) {
      expect(everything).not.toHaveProperty(forbidden);
    }
  });
});
