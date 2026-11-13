import { describe, expect, it } from 'vitest';
import { MAX_GALLERY, cleanGallery, productImages } from '../services/gallery.js';

describe('product gallery', () => {
  it('puts the cover first, then the extras in order', () => {
    expect(productImages({ enhanced_image_url: 'c', gallery_image_urls: ['a', 'b'] })).toEqual(['c', 'a', 'b']);
  });

  it('works for products from before multi-photo (no gallery column value)', () => {
    expect(productImages({ enhanced_image_url: 'c' })).toEqual(['c']);
    expect(productImages({ enhanced_image_url: 'c', gallery_image_urls: null })).toEqual(['c']);
  });

  it('never lists a photo twice, including the cover repeated as an extra', () => {
    expect(productImages({ enhanced_image_url: 'c', gallery_image_urls: ['a', 'c', 'a', 'b'] })).toEqual(['c', 'a', 'b']);
    expect(cleanGallery('c', ['a', 'c', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('stores nothing for a single-photo product', () => {
    expect(cleanGallery('c', [])).toEqual([]);
  });

  it('caps extras at a sensible number', () => {
    expect(MAX_GALLERY).toBeGreaterThanOrEqual(3);
  });
});
