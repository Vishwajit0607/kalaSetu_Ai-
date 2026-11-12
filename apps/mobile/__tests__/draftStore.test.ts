import { shallow } from 'zustand/shallow';
import { useCatalogDraftStore } from '../store/useCatalogDraftStore';
import type { CatalogGeneration, PricingBreakdown } from '../services/apiClient';

const catalog = { title_en: 'Pot', title_hi: 'मटका' } as CatalogGeneration;
const pricing = { recommended_retail_inr: 1390, recommended_wholesale_inr: 912 } as PricingBreakdown;

const state = () => useCatalogDraftStore.getState();

/** A draft that has everything the server needs. */
function completeDraft() {
  const s = state();
  s.setCapture('file:///cache/small.jpg');
  s.setUploaded({ rawUrl: 'https://cdn/raw.jpg', enhancedUrl: 'https://cdn/enh.png', degraded: false });
  s.setCatalog(catalog);
  s.setCosting({ materialCostInr: 180, laborHours: 5, dimensionsCm: { length: 18, width: 18, height: 22 } });
  s.setPricing(pricing);
}

beforeEach(() => state().reset());

describe('isCommittable', () => {
  it('is true once photo, listing, price, cost and size are all present', () => {
    completeDraft();
    expect(state().isCommittable()).toBe(true);
  });

  it.each([
    ['no hosted photo', () => state().setCapture('file:///x.jpg')],
    ['no listing', () => state().resetVoice()],
    ['no price', () => state().setPricing(null)],
    ['zero material cost', () => state().setCosting({ materialCostInr: 0 })],
    // The server rejects a zero length/width. The old client let the artisan
    // reach the final button and then fail there.
    ['zero length', () => state().setCosting({ dimensionsCm: { length: 0 } })],
    ['zero width', () => state().setCosting({ dimensionsCm: { width: 0 } })],
  ])('is false with %s', (_label, breakIt) => {
    completeDraft();
    breakIt();
    expect(state().isCommittable()).toBe(false);
  });

  it('allows a zero height - a saree or a painting has none', () => {
    completeDraft();
    state().setCosting({ dimensionsCm: { height: 0 } });
    expect(state().isCommittable()).toBe(true);
  });
});

describe('a new capture invalidates everything that belonged to the old photo', () => {
  it('drops the hosted URLs and the degraded flag', () => {
    completeDraft();
    state().setUploaded({ rawUrl: 'https://cdn/r.jpg', enhancedUrl: 'https://cdn/r.jpg', degraded: true });

    state().setCapture('file:///cache/retake.jpg');

    expect(state().rawImageUrl).toBeNull();
    expect(state().enhancedImageUrl).toBeNull();
    expect(state().studioDegraded).toBe(false);
  });
});

describe('re-recording', () => {
  it('clears the previous transcript, listing and price so stale results are not shown as current', () => {
    completeDraft();
    state().setTranscript('old words');
    state().setTranslations({ hindi: 'पुराना', english: 'old' });

    state().resetVoice();

    expect(state().nativeTranscript).toBeNull();
    expect(state().englishText).toBeNull();
    expect(state().catalog).toBeNull();
    expect(state().pricing).toBeNull();
  });

  it('keeps the photo - only the voice half is redone', () => {
    completeDraft();
    state().resetVoice();
    expect(state().enhancedImageUrl).toBe('https://cdn/enh.png');
  });
});

describe('pricing-loop regression', () => {
  it('writing a price does not change any field the price is computed from', () => {
    // The pricing screen recalculates when these change. `setPricing` is called
    // from inside that calculation; if it altered any of them the screen would
    // recalculate forever. The old code subscribed to the whole store object,
    // which is replaced on every set, so it did exactly that.
    completeDraft();
    const inputs = () => {
      const s = state();
      return {
        material: s.materialCostInr,
        labor: s.laborHours,
        length: s.dimensionsCm.length,
        width: s.dimensionsCm.width,
        height: s.dimensionsCm.height,
        complexity: s.catalog?.craft_complexity_score,
      };
    };

    const before = inputs();
    state().setPricing({ ...pricing, recommended_retail_inr: 9999 });

    expect(shallow(before, inputs())).toBe(true);
  });

  it('the whole store object DOES change on every set - which is why it must not be a dependency', () => {
    const a = state();
    state().setPricing(pricing);
    expect(state()).not.toBe(a);
  });
});

describe('stock quantity', () => {
  it('defaults to 1 and clamps to a sane range', () => {
    expect(state().stockQuantity).toBe(1);
    state().setStockQuantity(-5);
    expect(state().stockQuantity).toBe(0);
    state().setStockQuantity(9_999_999);
    expect(state().stockQuantity).toBe(100_000);
  });
});
