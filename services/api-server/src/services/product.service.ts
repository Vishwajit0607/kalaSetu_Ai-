import { z } from 'zod';
import { removeMedia, storagePathFromUrl, supabase } from './supabase.service.js';
import { isMissingTable } from './missingSchema.js';
import { translateText } from './sarvam.service.js';
import { MAX_GALLERY, cleanGallery } from './gallery.js';
import type { DimensionsCm, Product } from '../types/index.js';

/**
 * Looking after a saved product: reading it, editing it, deleting and restoring it,
 * and its price history.
 *
 * Every function takes the artisan id as its first argument and filters by it. That id
 * comes from the verified login token (never from the request), so a product that is
 * not the caller's is indistinguishable from one that does not exist: both are
 * "not found", and nothing about someone else's catalog leaks.
 */

export class ProductError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

/**
 * One product, only if it belongs to this artisan. A soft-deleted product counts as
 * missing unless `includeDeleted` is set (restoring needs to see it).
 */
export async function getOwnedProduct(
  artisanId: string,
  productId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Product | null> {
  let builder = supabase()
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('artisan_id', artisanId);
  if (!options.includeDeleted) builder = builder.is('deleted_at', null);

  const { data, error } = await builder.maybeSingle();
  if (error) throw new Error(`product lookup failed: ${error.message}`);
  return (data as Product | null) ?? null;
}

/** Like `getOwnedProduct`, but a missing product is an error the route turns into a 404. */
export async function requireOwnedProduct(
  artisanId: string,
  productId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Product> {
  const product = await getOwnedProduct(artisanId, productId, options);
  if (!product) throw new ProductError('not_found', 'product not found');
  return product;
}

/* ------------------------------------------------------------------- editing */

/** Matches the column widths (NUMERIC(10,2), NUMERIC(6,1)) so an overflow is a 400, not a 500. */
const MAX_MONEY = 10_000_000;

const dimensionsPatch = z
  .object({
    length: z.number().positive().max(100_000).optional(),
    width: z.number().positive().max(100_000).optional(),
    height: z.number().nonnegative().max(100_000).optional(),
    weight_grams: z.number().nonnegative().max(10_000_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'dimensions_cm must change at least one measurement' });

/**
 * The fields an artisan may change on a saved product.
 *
 * STRICT: any other key is refused, not ignored. That is what keeps `stock_quantity`
 * out (stock belongs to the inventory ledger, so every stock change leaves an audit
 * row), and it also refuses `artisan_id`, `sku`, `raw_image_url` and `deleted_at`, so a
 * request cannot reassign a product, rename its SKU or undelete it by the back door.
 */
export const productPatchSchema = z
  .object({
    title_en: z.string().trim().min(1).max(200).optional(),
    title_hi: z.string().trim().min(1).max(200).optional(),
    description_en: z.string().trim().max(5000).optional(),
    description_hi: z.string().trim().max(5000).optional(),
    seo_tags: z
      .array(z.string().trim().min(1).max(40))
      .max(30)
      // Tags are search keywords: one spelling each, so "Silk" and "silk" are the same tag.
      .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))])
      .optional(),
    hsn_code: z.string().trim().max(20).nullable().optional(),
    material_cost_inr: z.number().nonnegative().max(MAX_MONEY).optional(),
    labor_hours: z.number().nonnegative().max(1000).optional(),
    dimensions_cm: dimensionsPatch.optional(),
    recommended_retail_inr: z.number().positive().max(MAX_MONEY).optional(),
    recommended_wholesale_inr: z.number().positive().max(MAX_MONEY).optional(),
    min_wholesale_qty: z.number().int().positive().max(100_000).optional(),
    /** Make one of this product's extra photos the cover. See planPhotos. */
    cover_image_url: z.string().url().optional(),
    /** The extras to keep, in the order to show them: reorders, and removes any left out. */
    gallery_image_urls: z.array(z.string().url()).max(MAX_GALLERY).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'send at least one field to change' });

export type ProductPatch = z.infer<typeof productPatchSchema>;

/* -------------------------------------------------------------------- photos */

export interface PhotoState {
  enhanced_image_url: string;
  gallery_image_urls?: string[] | null;
}

export interface PhotoPlan {
  /** The cover after the change. */
  enhanced_image_url: string;
  /** The extras after the change, in display order, never containing the cover. */
  gallery_image_urls: string[];
  /** Photos that are no longer part of the product and can be deleted from storage. */
  removed: string[];
}

/**
 * Work out a product's photos after a reorder, a removal and/or a cover promotion.
 * Pure: no database, so every case is cheap to test.
 *
 * The one rule that matters: an edit can only REARRANGE photos the product already
 * has. It cannot introduce a URL, so it cannot attach someone else's photo or an
 * arbitrary link; new photos only ever come in through the studio, which checks they
 * were uploaded by this artisan.
 *
 *  - `gallery_image_urls` is the extras to keep, in the order wanted. Anything left out
 *    is removed.
 *  - `cover_image_url` promotes one of the extras. The old cover takes the promoted
 *    photo's place in the list, so no photo is lost and the count stays the same.
 *  - Reordering/removing is applied first, then the promotion, so a request can do both.
 */
export function planPhotos(
  current: PhotoState,
  request: { cover_image_url?: string; gallery_image_urls?: string[] },
): PhotoPlan {
  const currentGallery = cleanGallery(current.enhanced_image_url, current.gallery_image_urls ?? []);
  let gallery = [...currentGallery];

  if (request.gallery_image_urls) {
    const wanted = request.gallery_image_urls;
    if (new Set(wanted).size !== wanted.length) {
      throw new ProductError('invalid', 'the same photo is listed twice');
    }
    for (const url of wanted) {
      if (!currentGallery.includes(url)) {
        throw new ProductError('invalid', 'gallery_image_urls can only contain photos this product already has');
      }
    }
    gallery = wanted;
  }

  let cover = current.enhanced_image_url;
  if (request.cover_image_url && request.cover_image_url !== cover) {
    const at = gallery.indexOf(request.cover_image_url);
    if (at === -1) {
      throw new ProductError('invalid', 'the new cover must be one of this product\'s extra photos');
    }
    gallery = gallery.map((url, index) => (index === at ? cover : url));
    cover = request.cover_image_url;
  }

  return {
    enhanced_image_url: cover,
    gallery_image_urls: gallery,
    removed: currentGallery.filter((url) => !gallery.includes(url) && url !== cover),
  };
}

/**
 * Change some of a product's fields. Returns the updated product.
 *
 * Measurements merge into the existing ones (changing the length keeps the width).
 * Retail must stay above wholesale: that is checked against the values the product will
 * END UP with, so changing only one of the two prices cannot sneak past it.
 */
export async function updateProduct(
  artisanId: string,
  productId: string,
  patch: ProductPatch,
): Promise<Product> {
  const existing = await requireOwnedProduct(artisanId, productId);

  const retail = patch.recommended_retail_inr ?? Number(existing.recommended_retail_inr);
  const wholesale = patch.recommended_wholesale_inr ?? Number(existing.recommended_wholesale_inr);
  if (
    (patch.recommended_retail_inr !== undefined || patch.recommended_wholesale_inr !== undefined) &&
    retail <= wholesale
  ) {
    throw new ProductError('invalid', 'the retail price must be higher than the wholesale price');
  }

  const { dimensions_cm, cover_image_url, gallery_image_urls, ...rest } = patch;
  const row: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };

  let removedPhotos: string[] = [];
  if (cover_image_url !== undefined || gallery_image_urls !== undefined) {
    const plan = planPhotos(existing, { cover_image_url, gallery_image_urls });
    removedPhotos = plan.removed;
    if (plan.enhanced_image_url !== existing.enhanced_image_url) {
      row.enhanced_image_url = plan.enhanced_image_url;
    }
    // Only written when it really changed: a database that has not had the gallery
    // migration has no such column, and an unchanged list must not make this fail.
    const before = cleanGallery(existing.enhanced_image_url, existing.gallery_image_urls ?? []);
    if (JSON.stringify(plan.gallery_image_urls) !== JSON.stringify(before)) {
      row.gallery_image_urls = plan.gallery_image_urls;
    }
  }
  if (dimensions_cm) {
    row.dimensions_cm = { ...existing.dimensions_cm, ...dimensions_cm } satisfies DimensionsCm;
  }

  const { data, error } = await supabase()
    .from('products')
    .update(row)
    .eq('id', productId)
    .eq('artisan_id', artisanId)
    // Not if it was deleted between the read above and this write.
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`product update failed: ${error.message}`);
  if (!data) throw new ProductError('not_found', 'product not found');

  await discardPhotos(artisanId, removedPhotos);
  return data as Product;
}

/**
 * Delete photos that left the product from storage. Only after the product row has
 * been saved without them, and only the caller's own files. Best effort: a leftover
 * file costs a little storage, but failing the edit over it would be worse.
 */
async function discardPhotos(artisanId: string, urls: string[]): Promise<void> {
  const paths = urls
    .map((url) => storagePathFromUrl(url, artisanId))
    .filter((path): path is string => path !== null);
  if (paths.length === 0) return;
  await removeMedia(paths).catch(() => undefined);
}

/* ------------------------------------------------------------ delete / restore */

/**
 * Delete a product, reversibly: it is hidden, not removed. The row, its photos and its
 * price history all stay, so an accidental delete can be undone and nothing that points
 * at the product breaks.
 *
 * Only an existing, not-already-deleted product of the caller's can be deleted; anything
 * else (someone else's, missing, already deleted) is "not found".
 */
export async function softDeleteProduct(
  artisanId: string,
  productId: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase()
    .from('products')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', productId)
    .eq('artisan_id', artisanId)
    .is('deleted_at', null)
    .select('id, deleted_at')
    .maybeSingle();

  if (error) throw new Error(`product delete failed: ${error.message}`);
  if (!data) throw new ProductError('not_found', 'product not found');
  return data as { id: string; deleted_at: string };
}

/** Undo a delete. Only a product that IS deleted, and is the caller's, can be restored. */
export async function restoreProduct(artisanId: string, productId: string): Promise<Product> {
  const { data, error } = await supabase()
    .from('products')
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('artisan_id', artisanId)
    .not('deleted_at', 'is', null)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`product restore failed: ${error.message}`);
  if (!data) throw new ProductError('not_found', 'deleted product not found');
  return data as Product;
}

/* -------------------------------------------------------------- price history */

export interface PriceHistoryRow {
  id: string;
  retail_inr: number;
  wholesale_inr: number;
  source: 'create' | 'edit' | 'system';
  changed_at: string;
}

export interface PriceHistoryEntry extends PriceHistoryRow {
  /** How much this price differs from the one before it; null for the first price. */
  retail_change: number | null;
  wholesale_change: number | null;
}

export interface PriceHistoryPage {
  history: PriceHistoryEntry[];
  /** Pass back as `before` for the next (older) page; null when there is none. */
  next_before: string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Add "how much did it change" to each row. `rows` is newest first, so the row after
 * a given one is the price it replaced; the last row has nothing to compare with
 * (it is the first price, or the page was cut and the caller fetched one extra row).
 */
export function withChanges(rows: PriceHistoryRow[]): PriceHistoryEntry[] {
  return rows.map((row, index) => {
    const older = rows[index + 1];
    return {
      ...row,
      retail_change: older ? round2(row.retail_inr - older.retail_inr) : null,
      wholesale_change: older ? round2(row.wholesale_inr - older.wholesale_inr) : null,
    };
  });
}

/**
 * A product's past prices, newest first, paged with a time cursor.
 *
 * Ownership is checked FIRST, so another artisan's product has no history to read. The
 * table's numeric columns arrive as strings, so they are converted. Before migration
 * 020/021 is applied the table does not exist and the history is simply empty.
 */
export async function listPriceHistory(
  artisanId: string,
  productId: string,
  options: { limit: number; before?: string },
): Promise<PriceHistoryPage> {
  await requireOwnedProduct(artisanId, productId);

  let builder = supabase()
    .from('product_price_history')
    .select('id, retail_inr, wholesale_inr, source, changed_at')
    .eq('product_id', productId);
  if (options.before) builder = builder.lt('changed_at', options.before);

  // One extra row tells us whether another page exists, and gives the last row of this
  // page something to be compared with.
  const { data, error } = await builder
    .order('changed_at', { ascending: false })
    .limit(options.limit + 1);

  if (error) {
    if (isMissingTable(error)) return { history: [], next_before: null };
    throw new Error(`price history lookup failed: ${error.message}`);
  }

  const rows = ((data ?? []) as Array<Omit<PriceHistoryRow, 'retail_inr' | 'wholesale_inr'> & {
    retail_inr: number | string;
    wholesale_inr: number | string;
  }>).map((row) => ({ ...row, retail_inr: Number(row.retail_inr), wholesale_inr: Number(row.wholesale_inr) }));

  const hasMore = rows.length > options.limit;
  const entries = withChanges(rows).slice(0, options.limit);
  return { history: entries, next_before: hasMore ? (entries.at(-1)?.changed_at ?? null) : null };
}

/* ---------------------------------------------------------------- retranslate */

/**
 * Each request to the translator is kept well under any per-request size limit: a
 * 5,000-character description goes in as several sentence-aligned pieces rather than
 * one big one that might be refused or cut off.
 */
export const TRANSLATE_CHUNK = 900;

/**
 * Split text into pieces of at most `max` characters, preferring to break between
 * sentences (. ! ? the Devanagari danda, or a new line), then between words, and only
 * as a last resort in the middle of a word. Pieces re-join, with a space, to the
 * original words in order.
 */
export function splitForTranslation(text: string, max = TRANSLATE_CHUNK): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= max) return [clean];

  // Sentences, each broken further if it alone is too long.
  const pieces: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?\u0964\n])\s+/u)) {
    if (sentence.length <= max) {
      pieces.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(' ', max);
      const at = cut > 0 ? cut : max; // no space to break at: cut the word
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }

  // Pack pieces into chunks without exceeding the limit.
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > max) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

type ListingLanguage = 'en-IN' | 'hi-IN';

async function translateLong(text: string, from: ListingLanguage, to: ListingLanguage): Promise<string> {
  const parts: string[] = [];
  // One at a time: gentle on the vendor, and the order of the pieces is the order of the text.
  for (const chunk of splitForTranslation(text)) {
    const result = await translateText({ text: chunk, sourceLanguageCode: from, targetLanguageCode: to });
    if (result.text.trim()) parts.push(result.text.trim());
  }
  return parts.join(' ');
}

export interface RetranslateResult {
  from: ListingLanguage;
  to: ListingLanguage;
  /** What the other language's title and description would become (a field is absent if there was nothing to translate). */
  translations: { title?: string; description?: string };
  applied: boolean;
  /** The product after the change; null for a preview. */
  product: Product | null;
}

/**
 * Keep the Hindi and English text in step after one of them has been edited, using the
 * same Sarvam translation the listing is first written with.
 *
 * By default this is a PREVIEW: it returns what the other language would say and
 * changes nothing, so the artisan can read it, fix it, and only then save. Pass
 * `apply: true` to write it. It never touches the language it translates FROM.
 */
export async function retranslateProduct(
  artisanId: string,
  productId: string,
  options: { from: ListingLanguage; apply: boolean },
): Promise<RetranslateResult> {
  const product = await requireOwnedProduct(artisanId, productId);
  const to: ListingLanguage = options.from === 'en-IN' ? 'hi-IN' : 'en-IN';

  const sourceTitle = (options.from === 'en-IN' ? product.title_en : product.title_hi) ?? '';
  const sourceDescription = (options.from === 'en-IN' ? product.description_en : product.description_hi) ?? '';
  if (!sourceTitle.trim() && !sourceDescription.trim()) {
    throw new ProductError('invalid', 'there is no text in that language to translate');
  }

  const translations: { title?: string; description?: string } = {};
  if (sourceTitle.trim()) {
    const title = (await translateLong(sourceTitle, options.from, to)).slice(0, 200).trim();
    if (title) translations.title = title;
  }
  if (sourceDescription.trim()) {
    const description = (await translateLong(sourceDescription, options.from, to)).slice(0, 5000).trim();
    if (description) translations.description = description;
  }

  if (!options.apply || Object.keys(translations).length === 0) {
    return { from: options.from, to, translations, applied: false, product: null };
  }

  const suffix = to === 'en-IN' ? 'en' : 'hi';
  const patch: ProductPatch = {};
  if (translations.title) patch[`title_${suffix}`] = translations.title;
  if (translations.description) patch[`description_${suffix}`] = translations.description;

  return {
    from: options.from,
    to,
    translations,
    applied: true,
    product: await updateProduct(artisanId, productId, patch),
  };
}
