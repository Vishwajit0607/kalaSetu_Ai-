import { describe, expect, it } from 'vitest';
import { parseStockUtterance } from '../routes/inventory.routes.js';
import type { Product } from '../types/index.js';

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    artisan_id: 'a1',
    sku: 'KS-BAN-AAA111',
    raw_image_url: 'https://x/raw.jpg',
    enhanced_image_url: 'https://x/enh.png',
    voice_note_url: null,
    native_transcript: null,
    title_en: 'Blue Cotton Saree',
    title_hi: 'नीली सूती साड़ी',
    description_en: '',
    description_hi: '',
    seo_tags: ['saree', 'cotton'],
    hsn_code: '5208',
    material_cost_inr: 400,
    labor_hours: 6,
    dimensions_cm: { length: 550, width: 110, height: 1 },
    recommended_retail_inr: 1980,
    recommended_wholesale_inr: 1300,
    min_wholesale_qty: 5,
    stock_quantity: 10,
    marketplace_sync_status: { ondc: false, gem: false, b2b: false },
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const catalog = [
  product({}),
  product({
    id: 'p2',
    sku: 'KS-CHA-BBB222',
    title_en: 'Channapatna Wooden Elephant',
    title_hi: 'चन्नपटना लकड़ी का हाथी',
    seo_tags: ['toy', 'wooden'],
  }),
];

describe('parseStockUtterance', () => {
  it('extracts a digit quantity and the matching English SKU', () => {
    const result = parseStockUtterance('Sold 3 blue cotton saree today', catalog);
    expect(result.quantity).toBe(3);
    expect(result.match?.id).toBe('p1');
  });

  it('understands spoken Devanagari numerals', () => {
    const result = parseStockUtterance('तीन नीली सूती साड़ी बिक गईं', catalog);
    expect(result.quantity).toBe(3);
    expect(result.match?.id).toBe('p1');
  });

  it('matches on SKU when the artisan reads the tag aloud', () => {
    const result = parseStockUtterance('ks-cha-bbb222 do pieces gaye', catalog);
    expect(result.match?.id).toBe('p2');
  });

  it('defaults to a quantity of one when none is spoken', () => {
    const result = parseStockUtterance('wooden elephant sold', catalog);
    expect(result.quantity).toBe(1);
    expect(result.match?.id).toBe('p2');
  });

  it('refuses to guess when nothing in the catalog matches', () => {
    const result = parseStockUtterance('do kg aata le aao', catalog);
    expect(result.match).toBeNull();
  });

  it('returns no match but offers candidates on an ambiguous utterance', () => {
    const ambiguous = [
      product({ id: 'x1', sku: 'KS-AAA-111111', title_en: 'Cotton Stole', title_hi: 'सूती स्टोल' }),
      product({ id: 'x2', sku: 'KS-BBB-222222', title_en: 'Cotton Dupatta', title_hi: 'सूती दुपट्टा' }),
    ];
    const result = parseStockUtterance('do cotton bik gaye', ambiguous);
    expect(result.match).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});
