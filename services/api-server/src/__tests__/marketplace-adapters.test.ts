import { describe, expect, it } from 'vitest';
import {
  toGemCatalogRow,
  toOndcItem,
  toWhatsAppB2BMessage,
} from '../routes/marketplace.routes.js';
import type { Product } from '../types/index.js';

const sampleProduct: Product = {
  id: 'p1',
  artisan_id: 'a1',
  sku: 'KS-BAN-7F3A21',
  raw_image_url: 'https://cdn.kalasetu.app/raw.jpg',
  enhanced_image_url: 'https://cdn.kalasetu.app/enhanced.png',
  voice_note_url: 'https://cdn.kalasetu.app/voice.wav',
  native_transcript: 'यह बनारसी सिल्क साड़ी है',
  title_en: 'Handwoven Banarasi Silk Saree with Zari Border',
  title_hi: 'ज़री बॉर्डर वाली हाथ से बुनी बनारसी सिल्क साड़ी',
  description_en: 'A pure silk saree handwoven in Varanasi over 40 hours.',
  description_hi: 'वाराणसी में 40 घंटे में हाथ से बुनी शुद्ध रेशमी साड़ी।',
  seo_tags: ['banarasi', 'silk', 'saree', 'handloom', 'zari'],
  hsn_code: '5007',
  material_cost_inr: 3200,
  labor_hours: 40,
  dimensions_cm: { length: 550, width: 110, height: 2, weight_grams: 700 },
  recommended_retail_inr: 12400,
  recommended_wholesale_inr: 8900,
  min_wholesale_qty: 5,
  stock_quantity: 4,
  marketplace_sync_status: { ondc: false, gem: false, b2b: false },
  updated_at: '2026-11-12T10:00:00.000Z',
};

describe('toOndcItem', () => {
  const item = toOndcItem(sampleProduct, 'Ramesh Prasad');

  it('uses the SKU as the beckn item id', () => {
    expect(item.id).toBe('KS-BAN-7F3A21');
  });

  it('serialises price and quantity as strings per the ONDC contract', () => {
    expect((item.price as { value: string }).value).toBe('12400.00');
    expect(
      (item.quantity as { available: { count: string } }).available.count,
    ).toBe('4');
  });

  it('carries the statutory tags a seller-app rejects a listing without', () => {
    expect(item['@ondc/org/returnable']).toBe(true);
    expect(item['@ondc/org/return_window']).toBe('P7D');
    expect(item['@ondc/org/time_to_ship']).toBe('P3D');
    expect(
      item['@ondc/org/statutory_reqs_packaged_commodities'],
    ).toMatchObject({ manufacturer_or_packer_name: 'Ramesh Prasad' });
  });

  it('declares country of origin as India', () => {
    const tags = item.tags as Array<{ code: string; list: Array<{ value: string }> }>;
    const origin = tags.find((tag) => tag.code === 'origin');
    expect(origin?.list[0]?.value).toBe('IND');
  });
});

describe('toGemCatalogRow', () => {
  const row = toGemCatalogRow(sampleProduct, {
    full_name: 'Ramesh Prasad',
    gi_tag_certified: true,
    cluster_location: 'Varanasi, Uttar Pradesh',
  });

  it('declares HSN, unbranded status and Indian origin', () => {
    expect(row.hsn_code).toBe('5007');
    expect(row.brand).toBe('Unbranded');
    expect(row.country_of_origin).toBe('India');
  });

  it('prices GeM at the wholesale tier with MRP as the ceiling', () => {
    expect(row.offer_price_inr).toBe('8900.00');
    expect(row.mrp_inr).toBe('12400.00');
    expect(row.minimum_order_quantity).toBe(5);
  });

  it('attaches the MSME artisan declaration', () => {
    expect(row.msme_artisan_declaration).toMatchObject({
      artisan_name: 'Ramesh Prasad',
      gi_tag_certified: true,
    });
  });
});

describe('toWhatsAppB2BMessage', () => {
  const message = toWhatsAppB2BMessage(sampleProduct);

  it('leads with the Hindi title and includes both price tiers', () => {
    expect(message.startsWith('*ज़री बॉर्डर')).toBe(true);
    expect(message).toContain('₹8900');
    expect(message).toContain('₹12400');
  });

  it('includes the image URL and SKU so a buyer can quote it back', () => {
    expect(message).toContain(sampleProduct.enhanced_image_url);
    expect(message).toContain('KS-BAN-7F3A21');
  });

  it('states the minimum wholesale quantity', () => {
    expect(message).toContain('5+ pcs');
  });
});
