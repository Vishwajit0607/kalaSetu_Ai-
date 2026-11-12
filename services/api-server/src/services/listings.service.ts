import type { DimensionsCm } from '../types/index.js';
import { cleanGallery } from './gallery.js';

/**
 * Public marketplace listings: what one artisan may see of another's product.
 *
 * The API server holds the service-role key, which bypasses row-level security,
 * so RLS cannot be what keeps an artisan's private data private here. The
 * guarantee lives in this file instead: a listing is built field by field from
 * an allowlist, never by spreading the database row. A column added to
 * `products` tomorrow is therefore private until someone deliberately adds it
 * below.
 *
 * Deliberately absent: material cost, labour hours (the cost basis the
 * pricing engine protects), the raw photo, the voice note and its transcript,
 * sync status, and the seller's phone number.
 */

/** Columns read for a listing, plus the seller embedded through the FK. */
export const LISTING_SELECT = [
  'id',
  'artisan_id',
  'sku',
  'enhanced_image_url',
  'title_en',
  'title_hi',
  'description_en',
  'description_hi',
  'seo_tags',
  'hsn_code',
  'dimensions_cm',
  'recommended_retail_inr',
  'recommended_wholesale_inr',
  'min_wholesale_qty',
  'stock_quantity',
  'updated_at',
  // `!inner` makes this an inner join, so a craft filter on it removes
  // products and not just the embedded seller.
  'artisans!inner(id, full_name, craft_category, cluster_location, gi_tag_certified)',
].join(', ');

/**
 * The extra-photos column exists only once the gallery migration has been run.
 * Asking for a column that is not there fails the whole query, which would take
 * the bazaar down with it - so ask for it, and quietly go without if it is missing.
 */
export const LISTING_SELECT_WITH_GALLERY = LISTING_SELECT.replace(
  'enhanced_image_url,',
  'enhanced_image_url, gallery_image_urls,',
);

const GALLERY_RECHECK_MS = 60_000;
let galleryMissingUntil = 0;

/** Run a listings query with the gallery column when the database has it. */
export async function queryListings<R extends { error: { message: string } | null }>(
  run: (select: string) => PromiseLike<R>,
): Promise<R> {
  if (Date.now() >= galleryMissingUntil) {
    const result = await run(LISTING_SELECT_WITH_GALLERY);
    if (!result.error || !/gallery_image_urls/.test(result.error.message)) return result;
    galleryMissingUntil = Date.now() + GALLERY_RECHECK_MS;
  }
  return run(LISTING_SELECT);
}

export interface ListingRow {
  id: string;
  artisan_id: string;
  sku: string;
  enhanced_image_url: string;
  /** Absent when the gallery migration has not been run. */
  gallery_image_urls?: string[] | null;
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[] | null;
  hsn_code: string | null;
  dimensions_cm: DimensionsCm;
  recommended_retail_inr: number | string;
  recommended_wholesale_inr: number | string;
  min_wholesale_qty: number;
  stock_quantity: number;
  updated_at: string;
  artisans: {
    id: string;
    full_name: string;
    craft_category: string;
    cluster_location: string | null;
    gi_tag_certified: boolean;
  } | null;
}

export interface PublicListing {
  id: string;
  sku: string;
  enhanced_image_url: string;
  /** Extra angles after the cover. */
  gallery_image_urls: string[];
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string | null;
  dimensions_cm: DimensionsCm;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  min_wholesale_qty: number;
  stock_quantity: number;
  updated_at: string;
  /** True when the signed-in artisan owns it - the app labels these "Yours". */
  is_mine: boolean;
  seller: {
    id: string;
    full_name: string;
    craft_category: string;
    cluster_location: string | null;
    gi_tag_certified: boolean;
  };
}

/** Allowlisted projection. Returns null for a row whose seller is missing. */
export function toPublicListing(row: ListingRow, viewerId: string | null): PublicListing | null {
  const seller = row.artisans;
  if (!seller) return null;

  return {
    id: row.id,
    sku: row.sku,
    enhanced_image_url: row.enhanced_image_url,
    gallery_image_urls: cleanGallery(row.enhanced_image_url, row.gallery_image_urls ?? []),
    title_en: row.title_en,
    title_hi: row.title_hi,
    description_en: row.description_en,
    description_hi: row.description_hi,
    seo_tags: row.seo_tags ?? [],
    hsn_code: row.hsn_code,
    dimensions_cm: row.dimensions_cm,
    recommended_retail_inr: Number(row.recommended_retail_inr),
    recommended_wholesale_inr: Number(row.recommended_wholesale_inr),
    min_wholesale_qty: row.min_wholesale_qty,
    stock_quantity: row.stock_quantity,
    updated_at: row.updated_at,
    is_mine: viewerId !== null && row.artisan_id === viewerId,
    seller: {
      id: seller.id,
      full_name: seller.full_name,
      craft_category: seller.craft_category,
      cluster_location: seller.cluster_location,
      gi_tag_certified: seller.gi_tag_certified,
    },
  };
}

const MAX_SEARCH_LENGTH = 60;

/**
 * Make free text safe to splice into a PostgREST `or(...)` filter.
 *
 * That filter is a mini-language: a comma starts the next condition, parentheses
 * and colons are syntax, and `%` / `_` are LIKE wildcards. Left in, one
 * stray comma in a search box changes the query or makes it a 400. They are
 * replaced with spaces rather than dropped so "silk,saree" still searches for
 * both words.
 */
export function sanitizeSearch(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[%_,()*:\\"'{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

const MAX_SEARCH_WORDS = 4;

/**
 * Split a search box into independent words. A buyer typing "saree silk"
 * expects "Banarasi Silk Saree", so each word is matched on its own and the
 * words are ANDed (one `.or()` group per word) rather than the whole phrase
 * being required as one contiguous substring.
 */
export function searchWords(raw: string | undefined): string[] {
  const term = sanitizeSearch(raw);
  return term ? term.split(' ').slice(0, MAX_SEARCH_WORDS) : [];
}

/**
 * One word's condition: it appears in either title or the SKU, or is exactly
 * one of the product's tags (tags are single lower-case words). Expects a
 * single word from `searchWords` - a space would break the tag literal.
 */
export function searchFilter(word: string): string {
  return [
    `title_en.ilike.%${word}%`,
    `title_hi.ilike.%${word}%`,
    `sku.ilike.%${word}%`,
    `seo_tags.cs.{${word.toLowerCase()}}`,
  ].join(',');
}
