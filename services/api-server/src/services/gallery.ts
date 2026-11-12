/**
 * A product's photos: one cover (`enhanced_image_url`, the studio shot every
 * listing leads with) plus up to MAX_GALLERY extra angles.
 */

export const MAX_GALLERY = 5;

interface HasImages {
  enhanced_image_url: string;
  gallery_image_urls?: string[] | null;
}

/** Cover first, then the extras, de-duplicated and never empty. */
export function productImages(product: HasImages): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [product.enhanced_image_url, ...(product.gallery_image_urls ?? [])]) {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** The extras to store: unique, and without the cover repeated. */
export function cleanGallery(cover: string, gallery: string[]): string[] {
  return productImages({ enhanced_image_url: cover, gallery_image_urls: gallery }).slice(1);
}
