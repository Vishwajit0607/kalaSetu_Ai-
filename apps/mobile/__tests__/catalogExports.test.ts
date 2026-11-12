import {
  buildLookbookHtml,
  buildQrTagHtml,
  buildWholesalePitch,
} from '../services/catalogExports';
import type { ProductRow } from '../services/apiClient';

const product: ProductRow = {
  id: 'p1',
  artisan_id: 'a1',
  sku: 'KS-BAN-7F3A21',
  raw_image_url: 'https://cdn.kalasetu.app/raw.jpg',
  enhanced_image_url: 'https://cdn.kalasetu.app/enhanced.png',
  title_en: 'Handwoven Banarasi Silk Saree',
  title_hi: 'हाथ से बुनी बनारसी सिल्क साड़ी',
  description_en: 'A pure silk saree handwoven in Varanasi over forty hours.',
  description_hi: 'वाराणसी में चालीस घंटे में हाथ से बुनी शुद्ध रेशमी साड़ी।',
  seo_tags: ['banarasi', 'silk', 'saree'],
  hsn_code: '5007',
  stock_quantity: 4,
  recommended_retail_inr: 12400,
  recommended_wholesale_inr: 8900,
  min_wholesale_qty: 5,
  marketplace_sync_status: { ondc: true, gem: false, b2b: true },
  dimensions_cm: { length: 550, width: 110, height: 2 },
  updated_at: '2026-11-12T10:00:00.000Z',
};

describe('buildWholesalePitch', () => {
  const pitch = buildWholesalePitch(product);

  it('leads with the Hindi title in WhatsApp bold', () => {
    expect(pitch.startsWith('*हाथ से बुनी बनारसी सिल्क साड़ी*')).toBe(true);
  });

  it('states both price tiers and the minimum order quantity', () => {
    expect(pitch).toContain('₹8,900');
    expect(pitch).toContain('₹12,400');
    expect(pitch).toContain('5+ pcs');
  });

  it('includes stock, HSN, size, image URL and SKU', () => {
    expect(pitch).toContain('Stock: 4');
    expect(pitch).toContain('HSN: 5007');
    expect(pitch).toContain('550 × 110 cm');
    expect(pitch).toContain(product.enhanced_image_url);
    expect(pitch).toContain('SKU: KS-BAN-7F3A21');
  });

  it('omits the HSN line when the code is missing', () => {
    const pitchWithoutHsn = buildWholesalePitch({ ...product, hsn_code: null });
    expect(pitchWithoutHsn).not.toContain('HSN:');
  });
});

describe('buildLookbookHtml', () => {
  const html = buildLookbookHtml([product], 'Ramesh Prasad', 'Banarasi Silk');

  it('renders a print-ready A4 document', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('size: A4');
  });

  it('names the artisan and their craft in the header', () => {
    expect(html).toContain('Ramesh Prasad');
    expect(html).toContain('Banarasi Silk');
  });

  it('shows both titles and both price tiers per item', () => {
    expect(html).toContain('हाथ से बुनी बनारसी सिल्क साड़ी');
    expect(html).toContain('Handwoven Banarasi Silk Saree');
    expect(html).toContain('₹8,900');
    expect(html).toContain('₹12,400');
  });

  it('escapes HTML so a quote in a description cannot break the layout', () => {
    const risky = buildLookbookHtml(
      [{ ...product, description_en: 'Uses <b>"real"</b> zari & gold' }],
      'A & B Crafts',
      'Zari',
    );
    expect(risky).toContain('&lt;b&gt;');
    expect(risky).toContain('&quot;real&quot;');
    expect(risky).toContain('A &amp; B Crafts');
  });
});

describe('buildQrTagHtml', () => {
  it('sizes the tag for a 2x3 inch label printer and embeds the QR image', () => {
    const html = buildQrTagHtml(
      {
        sku: product.sku,
        title_en: product.title_en,
        wholesale_inr: 8900,
        retail_inr: 12400,
        qr_png_data_url: 'data:image/png;base64,AAAA',
      },
      product,
    );

    expect(html).toContain('size: 2in 3in');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('KS-BAN-7F3A21');
    expect(html).toContain('₹12,400');
  });
});
