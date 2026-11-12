import { loadEnv } from '../config/env.js';
import { spokenFor } from '../i18n.js';
import type { DimensionsCm, PricingBreakdown } from '../types/index.js';

/**
 * Intelligent pricing engine.
 *
 * Deterministic cost-plus math owns the floor, AI benchmarking only moves the
 * ceiling. That split is deliberate: an artisan must never be talked below
 * their own cost by a hallucinated "market rate", and they must always be able
 * to hear *why* a number was produced (`explainPricing`).
 *
 *   Base Cost  = C_material + (H_labor x R_skill) + C_packaging
 *   Wholesale  = Base Cost x (1 + M_wholesale)
 *   Retail     = Base Cost x (1 + M_retail)
 */

export interface PricingInput {
  materialCostInr: number;
  laborHours: number;
  dimensionsCm: DimensionsCm;
  /** 1-10 visual intricacy from Gemini; raises the effective skill rate. */
  complexityScore?: number;
  /** Optional AI-benchmarked retail price to blend in. */
  aiRetailInr?: number;
  aiWholesaleInr?: number;
  /** Override the cluster-average skill rate (INR/hour). */
  skillRateInrPerHour?: number;
}

/**
 * A score of 5 is the cluster baseline. Each point of intricacy above that
 * adds 9% to the hourly skill rate - a 10/10 Banarasi brocade hour is worth
 * roughly 1.45x a plain cotton weaving hour.
 */
function skillRateFor(baseRate: number, complexityScore: number): number {
  const score = Math.min(10, Math.max(1, complexityScore));
  return baseRate * (1 + (score - 5) * 0.09);
}

/**
 * Bulky items carry real freight cost, so add a volumetric packaging surcharge.
 *
 * Capped at MAX_PACKAGING_SURCHARGE because raw dimensions lie for textiles: a
 * saree is catalogued at its 550cm woven length but ships folded in a 2-litre
 * polybag. Uncapped, the formula billed ~INR 700 of packaging on a product that
 * costs INR 30 to pack, which would push the artisan's price above the market
 * band for the one craft category this app exists to serve.
 */
const MAX_PACKAGING_SURCHARGE = 180;

function packagingFor(base: number, dimensions: DimensionsCm): number {
  const volumeLitres =
    (dimensions.length * dimensions.width * Math.max(dimensions.height, 1)) / 1000;
  const surcharge = Math.min(MAX_PACKAGING_SURCHARGE, Math.max(0, volumeLitres - 5) * 6);
  return base + surcharge;
}

export function computePricing(input: PricingInput): PricingBreakdown {
  const env = loadEnv();
  const complexityScore = input.complexityScore ?? 5;
  const skillRate = skillRateFor(
    input.skillRateInrPerHour ?? env.SKILL_RATE_INR_PER_HOUR,
    complexityScore,
  );

  const materialCost = Math.max(0, input.materialCostInr);
  const laborCost = Math.max(0, input.laborHours) * skillRate;
  const packagingCost = packagingFor(env.PACKAGING_COST_INR, input.dimensionsCm);
  const baseCost = materialCost + laborCost + packagingCost;

  const deterministicWholesale = baseCost * (1 + env.WHOLESALE_MARGIN);
  const deterministicRetail = baseCost * (1 + env.RETAIL_MARGIN);

  // Blend 60/40 toward the AI benchmark when it is above the deterministic
  // floor; ignore it entirely when it would underprice the artisan's labour.
  const blend = (deterministic: number, ai?: number): number => {
    if (!ai || !Number.isFinite(ai) || ai <= deterministic) return deterministic;
    return deterministic * 0.6 + ai * 0.4;
  };

  const wholesale = Math.round(blend(deterministicWholesale, input.aiWholesaleInr));
  const retail = Math.max(
    Math.round(blend(deterministicRetail, input.aiRetailInr)),
    wholesale + 1,
  );

  const usedAi =
    (input.aiRetailInr ?? 0) > deterministicRetail ||
    (input.aiWholesaleInr ?? 0) > deterministicWholesale;

  return {
    material_cost_inr: round2(materialCost),
    labor_cost_inr: round2(laborCost),
    packaging_cost_inr: round2(packagingCost),
    base_cost_inr: round2(baseCost),
    skill_rate_inr_per_hour: round2(skillRate),
    complexity_score: complexityScore,
    wholesale_margin: env.WHOLESALE_MARGIN,
    retail_margin: env.RETAIL_MARGIN,
    recommended_wholesale_inr: wholesale,
    recommended_retail_inr: retail,
    wholesale_profit_inr: round2(wholesale - baseCost),
    retail_profit_inr: round2(retail - baseCost),
    competitor_band_inr: {
      low: Math.round(retail * 0.82),
      high: Math.round(retail * 1.24),
    },
    source: usedAi ? 'ai-benchmarked' : 'deterministic',
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Spoken price explanation, in the artisan's own language.
 *
 * Read aloud by Bulbul TTS, so it is a sequence of short sentences rather
 * than a table: the whole point is that an artisan can repeat this back to a
 * middleman who is pushing the price down.
 */
export function explainPricing(
  breakdown: PricingBreakdown,
  languageCode = 'hi-IN',
): string {
  const s = spokenFor(languageCode);
  return [
    s('price.material', { amount: Math.round(breakdown.material_cost_inr) }),
    s('price.labour', { amount: Math.round(breakdown.labor_cost_inr) }),
    s('price.packaging', { amount: Math.round(breakdown.packaging_cost_inr) }),
    s('price.total', { amount: Math.round(breakdown.base_cost_inr) }),
    s('price.wholesale', { amount: breakdown.recommended_wholesale_inr }),
    s('price.retail', { amount: breakdown.recommended_retail_inr }),
    s('price.profit', { amount: Math.round(breakdown.retail_profit_inr) }),
  ].join(' ');
}
