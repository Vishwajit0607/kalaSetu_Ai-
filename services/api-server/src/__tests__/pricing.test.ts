import { describe, expect, it } from 'vitest';
import { computePricing, explainPricing } from '../services/pricing.service.js';

const dimensions = { length: 20, width: 15, height: 2 };

describe('computePricing', () => {
  it('follows the cost-plus formula at the cluster baseline complexity', () => {
    const result = computePricing({
      materialCostInr: 400,
      laborHours: 6,
      dimensionsCm: dimensions,
    });

    // 400 material + (6h x 95) labour + 45 packaging = 1015
    expect(result.base_cost_inr).toBe(1015);
    expect(result.recommended_wholesale_inr).toBe(Math.round(1015 * 1.28));
    expect(result.recommended_retail_inr).toBe(Math.round(1015 * 1.95));
    expect(result.source).toBe('deterministic');
  });

  it('raises the skill rate with visual intricacy', () => {
    const plain = computePricing({
      materialCostInr: 400,
      laborHours: 10,
      dimensionsCm: dimensions,
      complexityScore: 5,
    });
    const intricate = computePricing({
      materialCostInr: 400,
      laborHours: 10,
      dimensionsCm: dimensions,
      complexityScore: 10,
    });

    expect(intricate.skill_rate_inr_per_hour).toBeGreaterThan(plain.skill_rate_inr_per_hour);
    expect(intricate.recommended_retail_inr).toBeGreaterThan(plain.recommended_retail_inr);
  });

  it('ignores an AI benchmark that would underprice the artisan', () => {
    const result = computePricing({
      materialCostInr: 400,
      laborHours: 6,
      dimensionsCm: dimensions,
      aiRetailInr: 300,
      aiWholesaleInr: 250,
    });

    expect(result.recommended_retail_inr).toBeGreaterThan(result.base_cost_inr);
    expect(result.source).toBe('deterministic');
  });

  it('blends upward when the AI benchmark beats the deterministic ceiling', () => {
    const baseline = computePricing({
      materialCostInr: 400,
      laborHours: 6,
      dimensionsCm: dimensions,
    });
    const blended = computePricing({
      materialCostInr: 400,
      laborHours: 6,
      dimensionsCm: dimensions,
      aiRetailInr: 4000,
    });

    expect(blended.recommended_retail_inr).toBeGreaterThan(baseline.recommended_retail_inr);
    expect(blended.source).toBe('ai-benchmarked');
  });

  it('keeps retail strictly above wholesale and never sells below cost', () => {
    const result = computePricing({
      materialCostInr: 0,
      laborHours: 0,
      dimensionsCm: { length: 1, width: 1, height: 1 },
    });

    expect(result.recommended_retail_inr).toBeGreaterThan(result.recommended_wholesale_inr);
    expect(result.wholesale_profit_inr).toBeGreaterThanOrEqual(0);
  });

  it('caps the packaging surcharge so a folded textile is not billed as a crate', () => {
    // A saree: 550cm woven length, but it ships folded in a polybag.
    const saree = computePricing({
      materialCostInr: 3200,
      laborHours: 40,
      dimensionsCm: { length: 550, width: 110, height: 2 },
    });

    // 45 base + the 180 cap, not the ~700 the uncapped formula produced.
    expect(saree.packaging_cost_inr).toBeLessThanOrEqual(225);
  });

  it('adds a volumetric surcharge for bulky pieces', () => {
    const small = computePricing({
      materialCostInr: 500,
      laborHours: 4,
      dimensionsCm: { length: 10, width: 10, height: 10 },
    });
    const bulky = computePricing({
      materialCostInr: 500,
      laborHours: 4,
      dimensionsCm: { length: 60, width: 40, height: 30 },
    });

    expect(bulky.packaging_cost_inr).toBeGreaterThan(small.packaging_cost_inr);
  });

  it('produces a Hindi rationale containing both price tiers', () => {
    const breakdown = computePricing({
      materialCostInr: 400,
      laborHours: 6,
      dimensionsCm: dimensions,
    });
    const spoken = explainPricing(breakdown, 'hi-IN');

    expect(spoken).toContain(String(breakdown.recommended_wholesale_inr));
    expect(spoken).toContain(String(breakdown.recommended_retail_inr));
    expect(spoken).toMatch(/रुपये/);
  });
});
