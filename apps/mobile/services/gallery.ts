/** A product's photos: the cover first, then its extra angles, never repeated. */
export function productImages(product: {
  enhanced_image_url: string;
  gallery_image_urls?: string[] | null;
}): string[] {
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
