import { loadEnv } from '../config/env.js';
import { fetchWithRetry, UpstreamError } from './http.js';
import {
  SYSTEM_INSTRUCTION,
  buildCatalogPrompt,
  normalizeCatalog,
  type CatalogParams,
} from './gemini.service.js';
import type { CatalogGeneration } from '../types/index.js';

/**
 * BharatCode fallback LLM - an OpenAI-compatible endpoint, used only as a
 * second opinion when Gemini's entire model chain (see gemini.service.ts) has
 * already failed.
 *
 * The point of a fallback is a different failure domain, not a cheaper
 * primary: Google rotates and retires Gemini model ids per-key, and under
 * load every `gemini-3.x` id in the chain can sit at a 503 at once (observed
 * directly against this deployment's key). BharatCode's `qwen-3.8-27b` is a
 * different vendor, different quota, different outage calendar - text+image
 * input, OpenAI-style `json_schema` structured outputs, 262k context, which
 * is everything this call needs.
 *
 * It is never tried first. The product spec asks for Gemini 2.5 Flash / its
 * successors, and this only steps in after every one of them has failed.
 */

export function isBharatCodeConfigured(): boolean {
  return Boolean(loadEnv().BHARATCODE_API_KEY);
}

const JSON_ONLY = 'Respond with JSON only, matching the given schema exactly.';

/** OpenAI `json_schema` response_format - the structured-output equivalent of
 * Gemini's responseSchema, kept field-for-field identical to it. */
const CATALOG_JSON_SCHEMA = {
  name: 'artisan_catalog',
  schema: {
    type: 'object',
    properties: {
      title_en: { type: 'string', description: 'SEO-optimized English product title (max 150 chars)' },
      title_hi: { type: 'string', description: 'SEO-optimized Hindi product title in Devanagari' },
      description_en: { type: 'string', description: 'Compelling English description with craft story & specs' },
      description_hi: { type: 'string', description: 'Compelling Hindi description in Devanagari' },
      seo_tags: { type: 'array', items: { type: 'string' } },
      hsn_code: { type: 'string', description: '6-to-8 digit Indian HSN code for the craft category' },
      craft_complexity_score: { type: 'number', description: '1 to 10 rating based on visual intricacy' },
      recommended_retail_inr: { type: 'number' },
      recommended_wholesale_inr: { type: 'number' },
      pricing_rationale: {
        type: 'string',
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
    additionalProperties: false,
  },
} as const;

interface BharatCodeChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function generateCatalogViaBharatCode(
  params: CatalogParams,
): Promise<CatalogGeneration> {
  const env = loadEnv();
  if (!env.BHARATCODE_API_KEY) {
    throw new Error('BharatCode is not configured (BHARATCODE_API_KEY missing)');
  }

  const prompt = `${buildCatalogPrompt(params)}\nRespond as JSON.`;

  const response = await fetchWithRetry(
    `${env.BHARATCODE_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BHARATCODE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.BHARATCODE_MODEL,
        temperature: 0.2,
        // Bound the output: a runaway generation is the slowest failure mode.
        max_tokens: 3000,
        response_format: { type: 'json_schema', json_schema: CATALOG_JSON_SCHEMA },
        messages: [
          { role: 'system', content: `${SYSTEM_INSTRUCTION}\n${JSON_ONLY}` },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${params.mimeType ?? 'image/jpeg'};base64,${params.imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    },
    // One patient attempt, not two short ones. This model queues under load
    // (observed 10s to 57s for the same request), and two 45s attempts after
    // a 17s Gemini fallthrough blew straight past the phone's request timeout.
    // Worst case end to end is now ~17s + 75s, inside the client's 120s.
    { vendor: 'bharatcode', attempts: 1, timeoutMs: 75_000 },
  );

  const payload = (await response.json()) as BharatCodeChatResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new UpstreamError('bharatcode', 502, 'chat completion returned no content');

  const raw = JSON.parse(content) as Partial<CatalogGeneration>;
  return normalizeCatalog(raw, params);
}
