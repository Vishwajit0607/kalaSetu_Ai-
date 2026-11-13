import type { StringKey } from '@/i18n';
import type { ProductPatch, ProductRow } from './apiClient';

/**
 * The edit-product form, as pure functions.
 *
 * Limits mirror the server's `productPatchSchema` (title 1-200, description up to 5000,
 * up to 30 tags of up to 40 characters, HSN up to 20, prices above zero and up to
 * 1,00,00,000, minimum quantity a whole number from 1 to 100000, measurements up to
 * 100000). The server stays the authority - these checks exist so the artisan is told
 * which field to fix before any request is made, in their own language.
 *
 * Only fields that changed are sent: a PATCH that carries unchanged values still rewrites
 * them, and "nothing changed" is a state the screen should show rather than a pointless
 * request. Stock is deliberately absent - it changes through the inventory screens so each
 * change is recorded.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const TAGS_MAX = 30;
export const TAG_MAX = 40;
export const HSN_MAX = 20;
export const MONEY_MAX = 10_000_000;
export const MIN_QTY_MAX = 100_000;
export const DIMENSION_MAX = 100_000;

/** Everything is text while it is being typed; `validateProductForm` turns it into numbers. */
export interface ProductFormValues {
  titleEn: string;
  titleHi: string;
  descriptionEn: string;
  descriptionHi: string;
  /** Comma-separated. */
  tags: string;
  hsnCode: string;
  retail: string;
  wholesale: string;
  minQty: string;
  length: string;
  width: string;
  height: string;
}

export type ProductFormField = keyof ProductFormValues;

/** In the order the form shows them, which is also the order errors are reported in. */
export const FORM_FIELDS: readonly ProductFormField[] = [
  'titleEn',
  'titleHi',
  'descriptionEn',
  'descriptionHi',
  'retail',
  'wholesale',
  'minQty',
  'tags',
  'hsnCode',
  'length',
  'width',
  'height',
];

export type ProductFieldError =
  | 'productForm.err.titleEn'
  | 'productForm.err.titleHi'
  | 'productForm.err.titleLong'
  | 'productForm.err.descLong'
  | 'productForm.err.tagsMany'
  | 'productForm.err.tagLong'
  | 'productForm.err.hsnLong'
  | 'productForm.err.number'
  | 'productForm.err.priceZero'
  | 'productForm.err.priceHigh'
  | 'productForm.err.retailBelow'
  | 'productForm.err.qtyRange'
  | 'productForm.err.dimZero'
  | 'productForm.err.dimHigh';

export type ProductFormErrors = Partial<Record<ProductFormField, ProductFieldError & StringKey>>;

/** What a valid form produces: trimmed text, real numbers, one spelling per tag. */
export interface ValidProduct {
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string | null;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  min_wholesale_qty: number;
  dimensions_cm: { length: number; width: number; height: number };
}

export type ProductValidation = { ok: true; values: ValidProduct } | { ok: false; errors: ProductFormErrors };

/* ------------------------------------------------------------------ parsing */

const DEVANAGARI_ZERO = 0x0966;

/**
 * A number as an artisan types it: Hindi digits, rupee sign, and commas as in 1,20,000 are
 * all fine. Returns null for anything else (empty, letters, exponents, a second dot).
 */
export function parseNumber(text: string): number | null {
  const cleaned = text
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO))
    .replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Split on commas (Latin, full-width, Devanagari-style) and new lines; one lower-case spelling each. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,，、\n]/)) {
    const tag = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Titles: trim the ends and collapse runs of spaces. */
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/* --------------------------------------------------------------- validation */

export function validateProductForm(input: ProductFormValues): ProductValidation {
  const errors: ProductFormErrors = {};

  const titleEn = tidy(input.titleEn);
  const titleHi = tidy(input.titleHi);
  if (titleEn.length === 0) errors.titleEn = 'productForm.err.titleEn';
  else if (titleEn.length > TITLE_MAX) errors.titleEn = 'productForm.err.titleLong';
  if (titleHi.length === 0) errors.titleHi = 'productForm.err.titleHi';
  else if (titleHi.length > TITLE_MAX) errors.titleHi = 'productForm.err.titleLong';

  // Descriptions keep their line breaks; only the ends are trimmed.
  const descriptionEn = input.descriptionEn.trim();
  const descriptionHi = input.descriptionHi.trim();
  if (descriptionEn.length > DESCRIPTION_MAX) errors.descriptionEn = 'productForm.err.descLong';
  if (descriptionHi.length > DESCRIPTION_MAX) errors.descriptionHi = 'productForm.err.descLong';

  const tags = parseTags(input.tags);
  if (tags.length > TAGS_MAX) errors.tags = 'productForm.err.tagsMany';
  else if (tags.some((tag) => tag.length > TAG_MAX)) errors.tags = 'productForm.err.tagLong';

  const hsn = input.hsnCode.trim();
  if (hsn.length > HSN_MAX) errors.hsnCode = 'productForm.err.hsnLong';

  const price = (field: 'retail' | 'wholesale'): number | null => {
    const parsed = parseNumber(input[field]);
    if (parsed === null) {
      errors[field] = 'productForm.err.number';
      return null;
    }
    const value = round2(parsed);
    if (value <= 0) errors[field] = 'productForm.err.priceZero';
    else if (value > MONEY_MAX) errors[field] = 'productForm.err.priceHigh';
    return errors[field] ? null : value;
  };
  const retail = price('retail');
  const wholesale = price('wholesale');
  // Checked only once both prices are individually sound, and reported on the retail field.
  if (retail !== null && wholesale !== null && retail <= wholesale) errors.retail = 'productForm.err.retailBelow';

  const minQtyParsed = parseNumber(input.minQty);
  let minQty: number | null = null;
  if (minQtyParsed === null) errors.minQty = 'productForm.err.number';
  else if (!Number.isInteger(minQtyParsed) || minQtyParsed < 1 || minQtyParsed > MIN_QTY_MAX) errors.minQty = 'productForm.err.qtyRange';
  else minQty = minQtyParsed;

  const measure = (field: 'length' | 'width' | 'height'): number | null => {
    const parsed = parseNumber(input[field]);
    if (parsed === null) {
      errors[field] = 'productForm.err.number';
      return null;
    }
    // The server accepts a height of zero (a flat piece) but not a zero length or width.
    if (parsed === 0 && field !== 'height') errors[field] = 'productForm.err.dimZero';
    else if (parsed > DIMENSION_MAX) errors[field] = 'productForm.err.dimHigh';
    return errors[field] ? null : parsed;
  };
  const length = measure('length');
  const width = measure('width');
  const height = measure('height');

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      title_en: titleEn,
      title_hi: titleHi,
      description_en: descriptionEn,
      description_hi: descriptionHi,
      seo_tags: tags,
      // An emptied HSN is null on the server, not an empty string.
      hsn_code: hsn.length > 0 ? hsn : null,
      recommended_retail_inr: retail as number,
      recommended_wholesale_inr: wholesale as number,
      min_wholesale_qty: minQty as number,
      dimensions_cm: { length: length as number, width: width as number, height: height as number },
    },
  };
}

/* ------------------------------------------------------------ from / to a product */

/** The text boxes' starting contents for a saved product. */
export function valuesFromProduct(product: ProductRow): ProductFormValues {
  return {
    titleEn: product.title_en ?? '',
    titleHi: product.title_hi ?? '',
    descriptionEn: product.description_en ?? '',
    descriptionHi: product.description_hi ?? '',
    tags: (product.seo_tags ?? []).join(', '),
    hsnCode: product.hsn_code ?? '',
    // Prices can arrive from the database as "1000.00"; show them without a pointless ".00".
    retail: String(Number(product.recommended_retail_inr)),
    wholesale: String(Number(product.recommended_wholesale_inr)),
    minQty: String(product.min_wholesale_qty),
    length: String(Number(product.dimensions_cm.length)),
    width: String(Number(product.dimensions_cm.width)),
    height: String(Number(product.dimensions_cm.height)),
  };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Only what differs from the saved product. Empty means there is nothing to send.
 * Measurements are sent one by one, so changing the length does not rewrite the width.
 */
export function changedProductFields(saved: ProductRow, next: ValidProduct): ProductPatch {
  const patch: ProductPatch = {};

  if (next.title_en !== tidy(saved.title_en ?? '')) patch.title_en = next.title_en;
  if (next.title_hi !== tidy(saved.title_hi ?? '')) patch.title_hi = next.title_hi;
  if (next.description_en !== (saved.description_en ?? '').trim()) patch.description_en = next.description_en;
  if (next.description_hi !== (saved.description_hi ?? '').trim()) patch.description_hi = next.description_hi;

  if (!sameList(next.seo_tags, parseTags((saved.seo_tags ?? []).join(',')))) patch.seo_tags = next.seo_tags;

  const savedHsn = (saved.hsn_code ?? '').trim();
  if ((next.hsn_code ?? '') !== savedHsn) patch.hsn_code = next.hsn_code;

  if (next.recommended_retail_inr !== round2(Number(saved.recommended_retail_inr))) {
    patch.recommended_retail_inr = next.recommended_retail_inr;
  }
  if (next.recommended_wholesale_inr !== round2(Number(saved.recommended_wholesale_inr))) {
    patch.recommended_wholesale_inr = next.recommended_wholesale_inr;
  }
  if (next.min_wholesale_qty !== Number(saved.min_wholesale_qty)) patch.min_wholesale_qty = next.min_wholesale_qty;

  const dimensions: NonNullable<ProductPatch['dimensions_cm']> = {};
  for (const key of ['length', 'width', 'height'] as const) {
    if (next.dimensions_cm[key] !== Number(saved.dimensions_cm[key])) dimensions[key] = next.dimensions_cm[key];
  }
  if (Object.keys(dimensions).length > 0) patch.dimensions_cm = dimensions;

  return patch;
}
