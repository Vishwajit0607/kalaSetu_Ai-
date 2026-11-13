import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { supabase } from '../services/supabase.service.js';
import { synthesizeSpeech } from '../services/sarvam.service.js';
import type { Product, SupportedLanguage } from '../types/index.js';
import { spokenFor } from '../i18n.js';

/** Inventory CRUD, voice stock adjustment, QR tags and low-stock webhooks. */

const LOW_STOCK_THRESHOLD = 3;

export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /v1/inventory - the signed-in artisan's stock grid. */
  fastify.get('/', async (request, reply) => {
    const { data, error } = await supabase()
      .from('products')
      .select('*')
      .eq('artisan_id', request.artisanId as string)
      .order('updated_at', { ascending: false });

    if (error) return reply.internalServerError(error.message);

    const products = (data ?? []) as Product[];
    return reply.send({
      products,
      low_stock: products.filter((p) => p.stock_quantity <= LOW_STOCK_THRESHOLD),
      total_skus: products.length,
      stock_value_inr: products.reduce(
        (sum, p) => sum + p.stock_quantity * Number(p.recommended_wholesale_inr),
        0,
      ),
    });
  });

  /** PATCH /v1/inventory/:productId/stock - absolute set or relative delta. */
  fastify.patch<{ Params: { productId: string } }>(
    '/:productId/stock',
    async (request, reply) => {
      const body = z
        .object({
          delta: z.number().int().optional(),
          quantity: z.number().int().nonnegative().optional(),
        })
        .refine((v) => v.delta !== undefined || v.quantity !== undefined, {
          message: 'provide either delta or quantity',
        })
        .parse(request.body);

      const { data: current, error: readError } = await supabase()
        .from('products')
        .select('id, sku, stock_quantity, title_hi')
        .eq('id', request.params.productId)
        .eq('artisan_id', request.artisanId as string)
        .single();

      if (readError || !current) return reply.notFound('product not found');

      const next =
        body.quantity !== undefined
          ? body.quantity
          : Math.max(0, Number(current.stock_quantity) + (body.delta ?? 0));

      const { data, error } = await supabase()
        .from('products')
        .update({ stock_quantity: next, updated_at: new Date().toISOString() })
        .eq('id', request.params.productId)
        .eq('artisan_id', request.artisanId as string)
        .select()
        .single();

      if (error) return reply.internalServerError(error.message);

      return reply.send({
        product: data,
        previous_quantity: Number(current.stock_quantity),
        low_stock: next <= LOW_STOCK_THRESHOLD,
      });
    },
  );

  /**
   * POST /v1/inventory/voice-adjust
   *
   * Turns "तीन नीली सूती साड़ी बिक गईं" into a stock decrement. Matching is
   * fuzzy over SKU, Hindi title and English title because the artisan says the
   * product the way they think of it, never the way it is catalogued.
   */
  fastify.post('/voice-adjust', async (request, reply) => {
    const body = z
      .object({
        transcript: z.string().min(1),
        language_code: z.string().default('hi-IN'),
      })
      .parse(request.body);

    const { data, error } = await supabase()
      .from('products')
      .select('*')
      .eq('artisan_id', request.artisanId as string);

    if (error) return reply.internalServerError(error.message);

    const parsed = parseStockUtterance(body.transcript, (data ?? []) as Product[]);

    if (!parsed.match) {
      return reply.send({
        matched: false,
        spoken_confirmation: spokenFor(body.language_code)('stock.whichItem'),
        candidates: parsed.candidates.map((p) => ({ id: p.id, sku: p.sku, title_hi: p.title_hi })),
      });
    }

    const next = Math.max(0, parsed.match.stock_quantity - parsed.quantity);
    const { error: updateError } = await supabase()
      .from('products')
      .update({ stock_quantity: next, updated_at: new Date().toISOString() })
      .eq('id', parsed.match.id)
      .eq('artisan_id', request.artisanId as string);

    if (updateError) return reply.internalServerError(updateError.message);

    const spoken = spokenFor(body.language_code);
    // Read the product's title back in the same language as the sentence
    // around it - a Hindi title inside an English sentence is unreadable to
    // a text-to-speech voice.
    const spokenTitle =
      body.language_code === 'en-IN' ? parsed.match.title_en : parsed.match.title_hi;

    const confirmation =
      next <= LOW_STOCK_THRESHOLD
        ? spoken('stock.reducedLow', { qty: parsed.quantity, title: spokenTitle, left: next })
        : spoken('stock.reduced', { qty: parsed.quantity, title: spokenTitle, left: next });

    return reply.send({
      matched: true,
      product_id: parsed.match.id,
      sku: parsed.match.sku,
      quantity_sold: parsed.quantity,
      stock_quantity: next,
      low_stock: next <= LOW_STOCK_THRESHOLD,
      spoken_confirmation: confirmation,
    });
  });

  /** GET /v1/inventory/:productId/qr - printable trade-fair tag (PNG data URL). */
  fastify.get<{ Params: { productId: string }; Querystring: unknown }>(
    '/:productId/qr',
    async (request, reply) => {
      const query = z
        .object({ base_url: z.string().url().default('https://kalasetu.app/p') })
        .parse(request.query);

      const { data, error } = await supabase()
        .from('products')
        .select('id, sku, title_en, recommended_wholesale_inr, recommended_retail_inr')
        .eq('id', request.params.productId)
        // Scoped to the caller: without this, any product id from any artisan
        // returned its SKU and prices.
        .eq('artisan_id', request.artisanId as string)
        .maybeSingle();

      if (error || !data) return reply.notFound('product not found');

      const dataUrl = await QRCode.toDataURL(`${query.base_url}/${data.sku}`, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
        // High contrast so a cheap thermal printer still scans reliably.
        color: { dark: '#060705FF', light: '#FFFFFFFF' },
      });

      return reply.send({
        sku: data.sku,
        title_en: data.title_en,
        wholesale_inr: data.recommended_wholesale_inr,
        retail_inr: data.recommended_retail_inr,
        qr_png_data_url: dataUrl,
      });
    },
  );

  /** POST /v1/inventory/low-stock-alert - spoken alert for the dashboard. */
  fastify.post('/low-stock-alert', async (request, reply) => {
    const body = z
      .object({
        language_code: z.string().default('hi-IN'),
      })
      .parse(request.body);

    const { data, error } = await supabase()
      .from('products')
      .select('sku, title_hi, title_en, stock_quantity')
      .eq('artisan_id', request.artisanId as string)
      .lte('stock_quantity', LOW_STOCK_THRESHOLD);

    if (error) return reply.internalServerError(error.message);

    const items = data ?? [];
    if (items.length === 0) {
      return reply.send({ low_stock_count: 0, items: [], audio_base64: null });
    }

    const spoken = spokenFor(body.language_code);
    const text = spoken('stock.lowAlert', {
      count: items.length,
      items: items
        .map((i) =>
          spoken('stock.lowAlertItem', {
            title: body.language_code === 'en-IN' ? i.title_en : i.title_hi,
            count: i.stock_quantity,
          }),
        )
        .join(', '),
    });

    try {
      const audio = await synthesizeSpeech({
        text,
        languageCode: body.language_code as SupportedLanguage,
      });
      return reply.send({
        low_stock_count: items.length,
        items,
        spoken_text: text,
        audio_base64: audio.audio_base64,
      });
    } catch (ttsError) {
      // The alert still matters even when TTS is down - ship it silently.
      request.log.warn({ err: ttsError }, 'low-stock TTS failed');
      return reply.send({
        low_stock_count: items.length,
        items,
        spoken_text: text,
        audio_base64: null,
      });
    }
  });
};

/** Devanagari and Latin numerals the artisan actually says. */
const SPOKEN_NUMBERS: Record<string, number> = {
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function parseStockUtterance(
  transcript: string,
  products: Product[],
): { match: Product | null; quantity: number; candidates: Product[] } {
  const normalized = transcript.toLowerCase().trim();

  // Quantity: a digit anywhere, else a spoken numeral, else 1.
  const digitMatch = normalized.match(/\d+/);
  let quantity = digitMatch ? Number.parseInt(digitMatch[0], 10) : 0;
  if (!quantity) {
    for (const [word, value] of Object.entries(SPOKEN_NUMBERS)) {
      if (normalized.includes(word)) {
        quantity = value;
        break;
      }
    }
  }
  if (!quantity) quantity = 1;

  // Score each product on how many of its title tokens appear in the utterance.
  const scored = products
    .map((product) => {
      const tokens = [
        ...product.title_hi.split(/\s+/),
        ...product.title_en.toLowerCase().split(/\s+/),
        ...product.seo_tags.map((t) => t.toLowerCase()),
      ].filter((t) => t.length > 2);

      const hits = new Set(
        tokens.filter((token) => normalized.includes(token.toLowerCase())),
      ).size;

      const skuHit = normalized.includes(product.sku.toLowerCase()) ? 5 : 0;
      return { product, score: hits + skuHit };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];

  // Require a clear winner; an ambiguous match re-prompts by voice instead of
  // silently decrementing the wrong SKU.
  const decisive = best && (!runnerUp || best.score > runnerUp.score);

  return {
    match: decisive ? best.product : null,
    quantity,
    candidates: scored.slice(0, 4).map((entry) => entry.product),
  };
}
