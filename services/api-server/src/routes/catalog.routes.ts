import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { offlineCatalogDraft } from '../services/gemini.service.js';
import { generateCatalogAndPricing } from '../services/catalogOrchestrator.service.js';
import { computePricing, explainPricing } from '../services/pricing.service.js';
import {
  downloadMedia,
  generateSku,
  storagePathFromUrl,
  supabase,
} from '../services/supabase.service.js';
import { getArtisan } from '../services/auth.service.js';
import { UpstreamError } from '../services/http.js';

/** Gemini (+ BharatCode fallback) SEO + pricing orchestration, and product commit. */

const languageSchema = z.enum(['hi-IN', 'en-IN']);

const dimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().nonnegative().default(1),
  weight_grams: z.number().nonnegative().optional(),
});

const generateSchema = z.object({
  /** A studio image this server already stored - not bytes from the phone. */
  enhanced_image_url: z.string().url(),
  native_transcript: z.string().optional(),
  language_code: languageSchema.default('hi-IN'),
  // Optional: the listing is written at the voice step, before costs exist.
  material_cost_inr: z.number().nonnegative().optional(),
  labor_hours: z.number().nonnegative().optional(),
  dimensions_cm: dimensionsSchema.optional(),
});

const priceSchema = z.object({
  material_cost_inr: z.number().nonnegative(),
  labor_hours: z.number().nonnegative(),
  dimensions_cm: dimensionsSchema,
  complexity_score: z.number().min(1).max(10).optional(),
  ai_retail_inr: z.number().positive().optional(),
  ai_wholesale_inr: z.number().positive().optional(),
  skill_rate_inr_per_hour: z.number().positive().optional(),
  language_code: languageSchema.default('hi-IN'),
});

const productSchema = z.object({
  raw_image_url: z.string().url(),
  enhanced_image_url: z.string().url(),
  voice_note_url: z.string().url().nullable().optional(),
  native_transcript: z.string().nullable().optional(),
  title_en: z.string().trim().min(1).max(200),
  title_hi: z.string().trim().min(1).max(200),
  description_en: z.string(),
  description_hi: z.string(),
  seo_tags: z.array(z.string()).max(30).default([]),
  hsn_code: z.string().max(20).nullable().optional(),
  material_cost_inr: z.number().nonnegative(),
  labor_hours: z.number().nonnegative(),
  dimensions_cm: dimensionsSchema,
  recommended_retail_inr: z.number().positive(),
  recommended_wholesale_inr: z.number().positive(),
  min_wholesale_qty: z.number().int().positive().default(5),
  stock_quantity: z.number().int().min(0).max(100_000).default(1),
});

export const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/catalog/generate
   *
   * Always synchronous. The mobile app has already transcribed and translated
   * by the time it calls this; what is left is the single Gemini/BharatCode
   * structured-output generation, which the voice screen's timeline drives
   * directly off this response.
   *
   * `pricing` is null unless the caller supplied costs. Computing it from
   * zeroes produced a confident-looking wholesale price of about INR 58 that
   * the pricing screen then displayed before the artisan had entered anything.
   */
  fastify.post('/generate', async (request, reply) => {
    const artisanId = request.artisanId as string;
    const body = generateSchema.parse(request.body);

    const path = storagePathFromUrl(body.enhanced_image_url, artisanId);
    if (!path) return reply.badRequest('enhanced_image_url must be an image you uploaded');

    // Craft and cluster come from the account, not the client.
    const artisan = await getArtisan(artisanId);
    if (!artisan) return reply.notFound('account not found');

    const imageBase64 = (await downloadMedia(path)).toString('base64');
    const hasCosts = body.material_cost_inr !== undefined && body.labor_hours !== undefined;

    try {
      const catalog = await generateCatalogAndPricing({
        imageBase64,
        nativeTranscript: body.native_transcript ?? '',
        ...(body.material_cost_inr !== undefined ? { materialCostInr: body.material_cost_inr } : {}),
        ...(body.labor_hours !== undefined ? { laborHours: body.labor_hours } : {}),
        ...(body.dimensions_cm ? { dimensionsCm: body.dimensions_cm } : {}),
        craftCategory: artisan.craft_category,
        ...(artisan.cluster_location ? { clusterLocation: artisan.cluster_location } : {}),
        languageCode: body.language_code,
        mimeType: path.endsWith('.png') ? 'image/png' : 'image/jpeg',
      });

      const pricing = hasCosts
        ? computePricing({
            materialCostInr: body.material_cost_inr as number,
            laborHours: body.labor_hours as number,
            dimensionsCm: body.dimensions_cm ?? { length: 30, width: 20, height: 2 },
            complexityScore: catalog.craft_complexity_score,
            aiRetailInr: catalog.recommended_retail_inr,
            aiWholesaleInr: catalog.recommended_wholesale_inr,
          })
        : null;

      return reply.send({ catalog, pricing, degraded: false });
    } catch (error) {
      if (error instanceof UpstreamError || error instanceof SyntaxError) {
        request.log.warn({ err: error }, 'catalog LLMs unavailable, returning offline draft');
        const catalog = offlineCatalogDraft({
          nativeTranscript: body.native_transcript ?? '',
          ...(body.material_cost_inr !== undefined ? { materialCostInr: body.material_cost_inr } : {}),
          ...(body.labor_hours !== undefined ? { laborHours: body.labor_hours } : {}),
          languageCode: body.language_code,
        });
        return reply.send({ catalog, pricing: null, degraded: true });
      }
      throw error;
    }
  });

  /** POST /v1/catalog/price - pure deterministic math, no external calls. */
  fastify.post('/price', async (request, reply) => {
    const body = priceSchema.parse(request.body);
    const breakdown = computePricing({
      materialCostInr: body.material_cost_inr,
      laborHours: body.labor_hours,
      dimensionsCm: body.dimensions_cm,
      ...(body.complexity_score !== undefined ? { complexityScore: body.complexity_score } : {}),
      ...(body.ai_retail_inr !== undefined ? { aiRetailInr: body.ai_retail_inr } : {}),
      ...(body.ai_wholesale_inr !== undefined ? { aiWholesaleInr: body.ai_wholesale_inr } : {}),
      ...(body.skill_rate_inr_per_hour !== undefined
        ? { skillRateInrPerHour: body.skill_rate_inr_per_hour }
        : {}),
    });

    return reply.send({
      breakdown,
      rationale: explainPricing(breakdown, body.language_code),
    });
  });

  /**
   * POST /v1/catalog/products - commit an approved draft.
   *
   * Every media URL must be one this server handed out for *this* artisan.
   * The client used to send its own on-device `file://` paths, which passed
   * validation and were saved - products whose photos could never load on any
   * other phone, and that no marketplace payload could use.
   */
  fastify.post('/products', async (request, reply) => {
    const artisanId = request.artisanId as string;
    const body = productSchema.parse(request.body);

    const media: Array<[string, string | null | undefined]> = [
      ['raw_image_url', body.raw_image_url],
      ['enhanced_image_url', body.enhanced_image_url],
      ['voice_note_url', body.voice_note_url],
    ];
    for (const [field, url] of media) {
      if (url && !storagePathFromUrl(url, artisanId)) {
        return reply.badRequest(`${field} must be a file you uploaded through KalaSetu`);
      }
    }

    const artisan = await getArtisan(artisanId);
    if (!artisan) return reply.notFound('account not found');

    const { data, error } = await supabase()
      .from('products')
      .insert({
        ...body,
        artisan_id: artisanId,
        sku: generateSku(artisan.craft_category),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return reply.internalServerError(`Product insert failed: ${error.message}`);
    return reply.code(201).send(data);
  });
};
