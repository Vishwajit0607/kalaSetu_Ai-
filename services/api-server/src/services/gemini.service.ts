import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { loadEnv } from '../config/env.js';
import { languageName, spokenFor } from '../i18n.js';
import type { CatalogGeneration, DimensionsCm } from '../types/index.js';

/**
 * Gemini 2.5 Flash with Structured Outputs.
 *
 * One multimodal call does the work that would otherwise need four: it reads
 * the enhanced product cutout, reads the artisan's transcribed voice note,
 * and returns bilingual SEO copy, an HSN code, a visual complexity score and
 * a price band - all shape-guaranteed by `responseSchema`.
 */

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: loadEnv().GEMINI_API_KEY });
  return client;
}

/**
 * Model fallback chain.
 *
 * Google retires model ids out from under deployed code, and retires them
 * *per key*: `gemini-2.5-flash` answers a ListModels call but returns
 * "no longer available to new users" on generateContent for a fresh key.
 * Meanwhile the replacement Google names in that error (`gemini-3.8-flash`)
 * can sit at a hard 503 for half a minute under load.
 *
 * So the service walks a chain rather than trusting one id: the configured
 * model first, then known-good alternates. An artisan's listing must not fail
 * because a model id rotated.
 *
 * Text models only. An earlier version of this list included a `-image`
 * model (image *generation*, unsuitable for structured text) and the retired
 * `gemini-2.5-flash`, which only added a guaranteed 404 and a few seconds to
 * every fallback.
 *
 * The default primary is a `flash-lite`, chosen deliberately - this call is
 * one image plus a short transcript against a fixed schema, which lite handles
 * correctly, and latency and cost per listing matter more here than headroom
 * the task never uses.
 */
const GEMINI_MODEL_CHAIN = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
] as const;

function modelChain(): string[] {
  const configured = loadEnv().GEMINI_MODEL;
  return [configured, ...GEMINI_MODEL_CHAIN.filter((model) => model !== configured)];
}

/**
 * True when an error means "this model id will not serve us" - a retired or
 * unknown id (404), or one that is capacity-shedding (503/429). Those are
 * worth trying the next model for. A 400 (bad schema) or 401 (bad key) is our
 * fault and the chain must not mask it.
 *
 * Exported for the test suite: misclassifying here either hides a real bug or
 * burns the whole chain on every call.
 */
export function isModelUnavailableError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === 'number') {
    return status === 404 || status === 429 || status === 503;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\b(404|429|503)\b|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|no longer available|not found for API version/i.test(
    message,
  );
}

const catalogPricingSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title_en: {
      type: Type.STRING,
      description: 'SEO-optimized English product title (max 150 chars)',
    },
    title_hi: {
      type: Type.STRING,
      description: 'SEO-optimized Hindi product title in Devanagari',
    },
    description_en: {
      type: Type.STRING,
      description: 'Compelling English description with craft story & specs',
    },
    description_hi: {
      type: Type.STRING,
      description: 'Compelling Hindi description in Devanagari',
    },
    seo_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    hsn_code: {
      type: Type.STRING,
      description: '6-to-8 digit Indian HSN code for the craft category',
    },
    craft_complexity_score: {
      type: Type.NUMBER,
      description: '1 to 10 rating based on visual intricacy',
    },
    recommended_retail_inr: { type: Type.NUMBER },
    recommended_wholesale_inr: { type: Type.NUMBER },
    pricing_rationale: {
      type: Type.STRING,
      description:
        "Simple explanation of the price for voice playback, in the artisan's own language",
    },
  },
  required: [
    'title_en',
    'title_hi',
    'description_en',
    'description_hi',
    'seo_tags',
    'hsn_code',
    'craft_complexity_score',
    'recommended_retail_inr',
    'recommended_wholesale_inr',
    'pricing_rationale',
  ],
};

export const SYSTEM_INSTRUCTION = `You are a senior Indian handicraft export merchandiser.
You write marketplace copy for ONDC, GeM and wholesale B2B buyers.
Rules:
- Never invent a GI tag, certification or award the artisan did not mention.
- Name the real craft tradition when the image and transcript support it
  (Banarasi, Pochampally, Warli, Channapatna, Blue Pottery, Kalamkari...).
- Hindi copy must be natural Devanagari, not transliterated English.
- HSN codes must be plausible for the product category (handloom fabric 5208,
  wooden toys 9503, terracotta 6912, brassware 7418, jewellery 7117).
- Never state dimensions, weight, materials or care instructions that the
  artisan did not give. If something was not said, leave it out - a buyer
  relies on every spec in the listing.
- Price in INR for the Indian domestic market and never below base cost.`;

export interface CatalogParams {
  imageBase64: string;
  nativeTranscript: string;
  /**
   * Costs and size are optional because the listing is written at the voice
   * step, before the artisan has reached the pricing screen. They used to be
   * required, so the client padded them with zero costs and an invented
   * 30x20x2 cm - and the model dutifully wrote those made-up dimensions into
   * the product description.
   */
  materialCostInr?: number;
  laborHours?: number;
  dimensionsCm?: DimensionsCm;
  craftCategory?: string;
  clusterLocation?: string;
  /** The artisan's language - the spoken price rationale is written in it. */
  languageCode?: string;
  mimeType?: string;
}

/**
 * The user-turn prompt, shared with the BharatCode fallback so the two
 * providers cannot drift apart on what they are asked.
 *
 * Cost and size lines appear only when the artisan supplied them.
 */
export function buildCatalogPrompt(params: CatalogParams): string {
  const lines = [
    `Analyze this artisan product image and voice transcript: "${params.nativeTranscript}".`,
    `Craft category: ${params.craftCategory ?? 'unspecified'}.`,
    `Artisan cluster: ${params.clusterLocation ?? 'unspecified'}.`,
  ];

  if (params.materialCostInr !== undefined && params.laborHours !== undefined) {
    lines.push(
      `Raw Material Cost: INR ${params.materialCostInr}, Labor Hours: ${params.laborHours}.`,
    );
  } else {
    lines.push('Costs are not known yet - base the price band on the product and market alone.');
  }

  if (params.dimensionsCm) {
    lines.push(`Dimensions: ${JSON.stringify(params.dimensionsCm)} cm.`);
  }

  lines.push('Generate bilingual SEO catalog metadata and fair retail/wholesale pricing in INR.');
  lines.push(
    `Write pricing_rationale in ${languageName(params.languageCode)} - it is read aloud to the artisan, so keep it to one or two plain spoken sentences.`,
  );
  return lines.join('\n');
}

export async function generateCatalogAndPricing(
  params: CatalogParams,
): Promise<CatalogGeneration> {
  const chain = modelChain();
  let lastError: unknown;

  for (const model of chain) {
    try {
      const raw = await callGemini(model, params);
      return normalizeCatalog(raw, params);
    } catch (error) {
      lastError = error;
      if (!isModelUnavailableError(error)) throw error;
      // Otherwise fall through and try the next model id.
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Gemini: every model in the fallback chain was unavailable');
}

/** Which model actually served the last successful call, for logging. */
export function geminiModelChain(): string[] {
  return modelChain();
}

async function callGemini(
  model: string,
  params: CatalogParams,
): Promise<Partial<CatalogGeneration>> {
  const response = await ai().models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          mimeType: params.mimeType ?? 'image/jpeg',
          data: params.imageBase64,
        },
      },
      { text: buildCatalogPrompt(params) },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: catalogPricingSchema,
      temperature: 0.2,
    },
  });

  return JSON.parse(response.text || '{}') as Partial<CatalogGeneration>;
}

/**
 * Structured Outputs guarantees the shape, not the sanity. Clamp the numeric
 * fields and backfill strings so a single odd generation can never ship an
 * empty title or a negative price into the artisan's live catalog.
 */
/** Exported so other catalog-LLM providers (see bharatcode.service.ts) can
 * clamp their own raw output through the exact same rules. */
export function normalizeCatalog(
  raw: Partial<CatalogGeneration>,
  params: CatalogParams,
): CatalogGeneration {
  // A sane minimum even with no costs: never fall back to a rupee or two.
  const floor = Math.max(100, (params.materialCostInr ?? 0) + (params.laborHours ?? 0) * 60);
  const clamp = (value: unknown, min: number): number => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : min;
    return Math.max(min, Math.round(n));
  };

  const wholesale = clamp(raw.recommended_wholesale_inr, Math.round(floor * 1.1));
  const retail = Math.max(clamp(raw.recommended_retail_inr, Math.round(floor * 1.6)), wholesale + 1);

  return {
    title_en: (raw.title_en || 'Handcrafted Artisan Product').slice(0, 200),
    title_hi: (raw.title_hi || 'हस्तनिर्मित शिल्प उत्पाद').slice(0, 200),
    description_en: raw.description_en || '',
    description_hi: raw.description_hi || '',
    seo_tags: Array.isArray(raw.seo_tags) ? raw.seo_tags.slice(0, 20) : [],
    hsn_code: raw.hsn_code || '9601',
    craft_complexity_score: Math.min(10, Math.max(1, Number(raw.craft_complexity_score) || 5)),
    recommended_retail_inr: retail,
    recommended_wholesale_inr: wholesale,
    pricing_rationale: raw.pricing_rationale || '',
  };
}

/**
 * Fallback for the offline / quota-exhausted path: build a usable draft from
 * the transcript alone so the artisan's voice work is never lost. The product
 * is marked `ai_pending` and re-enqueued by the sync worker.
 */
export function offlineCatalogDraft(params: {
  nativeTranscript: string;
  materialCostInr?: number;
  laborHours?: number;
  languageCode?: string;
}): CatalogGeneration {
  const spoken = spokenFor(params.languageCode);
  const firstLine = params.nativeTranscript.split(/[।.\n]/)[0]?.trim() ?? '';
  const base = Math.max(100, (params.materialCostInr ?? 0) + (params.laborHours ?? 0) * 95 + 45);
  return {
    title_en: firstLine.slice(0, 120) || 'Draft product (awaiting AI catalog)',
    title_hi: firstLine.slice(0, 120) || spoken('catalog.draftTitle'),
    description_en: params.nativeTranscript,
    description_hi: params.nativeTranscript,
    seo_tags: ['handmade', 'artisan', 'india'],
    hsn_code: '9601',
    craft_complexity_score: 5,
    recommended_retail_inr: Math.round(base * 1.95),
    recommended_wholesale_inr: Math.round(base * 1.28),
    pricing_rationale: spoken('catalog.offlineRationale'),
  };
}
