import { UpstreamError } from './http.js';
import {
  generateCatalogAndPricing as generateCatalogViaGemini,
  geminiModelChain,
  type CatalogParams,
} from './gemini.service.js';
import { generateCatalogViaBharatCode, isBharatCodeConfigured } from './bharatcode.service.js';
import type { CatalogGeneration } from '../types/index.js';

/**
 * Catalog LLM orchestrator.
 *
 * Gemini first, always - that is what the product spec asks for, and
 * gemini.service.ts already walks its own chain of Gemini model ids.
 * BharatCode only runs after *every* model in that chain has failed: it is a
 * safety net in a different vendor's failure domain, not a cost-saving
 * default, so it is never raced against Gemini and never tried first.
 *
 * catalog.routes.ts imports `generateCatalogAndPricing` from here rather
 * than from gemini.service.ts directly, so this fallback applies everywhere
 * catalog generation happens.
 */
export async function generateCatalogAndPricing(
  params: CatalogParams,
): Promise<CatalogGeneration> {
  try {
    return await generateCatalogViaGemini(params);
  } catch (geminiError) {
    if (!isBharatCodeConfigured()) throw geminiError;

    try {
      return await generateCatalogViaBharatCode(params);
    } catch (bharatCodeError) {
      // Both vendors are down - surface an UpstreamError so the existing
      // offline-draft fallback in catalog.routes.ts (which checks
      // `error instanceof UpstreamError`) still fires, the same as it does
      // for a single-vendor outage.
      const geminiMessage =
        geminiError instanceof Error ? geminiError.message : String(geminiError);
      const bharatCodeMessage =
        bharatCodeError instanceof Error ? bharatCodeError.message : String(bharatCodeError);
      throw new UpstreamError(
        'ai-catalog',
        503,
        `Gemini failed (${geminiMessage}); BharatCode fallback also failed (${bharatCodeMessage})`,
      );
    }
  }
}

export { geminiModelChain };
