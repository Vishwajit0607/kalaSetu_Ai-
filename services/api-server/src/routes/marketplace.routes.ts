import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { supabase } from '../services/supabase.service.js';
import { synthesizeSpeech, translateText } from '../services/sarvam.service.js';
import {
  queryListings,
  searchFilter,
  searchWords,
  toPublicListing,
  type ListingRow,
} from '../services/listings.service.js';
import { productImages } from '../services/gallery.js';
import type { Product, SupportedLanguage } from '../types/index.js';

/** ONDC / GeM / WhatsApp-B2B export adapters and the buyer inquiry feed. */

/**
 * ONDC retail catalog item, shaped to the beckn `on_search` provider items
 * contract. Prices are strings per the spec, and every item carries the
 * statutory @ondc/org tags that a seller-app rejects a listing without.
 */
export function toOndcItem(product: Product, artisanName: string): Record<string, unknown> {
  return {
    id: product.sku,
    descriptor: {
      name: product.title_en,
      code: product.hsn_code ?? '',
      short_desc: product.description_en.slice(0, 200),
      long_desc: product.description_en,
      images: productImages(product),
    },
    price: {
      currency: 'INR',
      value: Number(product.recommended_retail_inr).toFixed(2),
      maximum_value: Number(product.recommended_retail_inr).toFixed(2),
    },
    quantity: {
      available: { count: String(product.stock_quantity) },
      maximum: { count: String(product.stock_quantity) },
      unitized: { measure: { unit: 'unit', value: '1' } },
    },
    category_id: 'Handicrafts',
    '@ondc/org/returnable': true,
    '@ondc/org/cancellable': true,
    '@ondc/org/return_window': 'P7D',
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': 'P3D',
    '@ondc/org/available_on_cod': false,
    '@ondc/org/contact_details_consumer_care': `${artisanName}, support@kalasetu.app`,
    '@ondc/org/statutory_reqs_packaged_commodities': {
      manufacturer_or_packer_name: artisanName,
      common_or_generic_name_of_commodity: product.title_en,
      net_quantity_or_measure_of_commodity_in_pkg: `${product.dimensions_cm.length}x${product.dimensions_cm.width} cm`,
    },
    tags: [
      {
        code: 'origin',
        list: [{ code: 'country', value: 'IND' }],
      },
      {
        code: 'attribute',
        list: product.seo_tags.slice(0, 10).map((tag) => ({ code: 'tag', value: tag })),
      },
    ],
  };
}

/**
 * GeM (Government e-Marketplace) catalog row. GeM validates on HSN, brand
 * ("Unbranded" is accepted for handicrafts) and a declared country of origin.
 */
export function toGemCatalogRow(
  product: Product,
  artisan: { full_name: string; gi_tag_certified: boolean; cluster_location: string | null },
): Record<string, unknown> {
  return {
    seller_sku: product.sku,
    product_name: product.title_en,
    category: 'Handicrafts and Handloom Products',
    hsn_code: product.hsn_code ?? '',
    brand: 'Unbranded',
    brand_type: 'Unregistered',
    model: product.sku,
    country_of_origin: 'India',
    offer_price_inr: Number(product.recommended_wholesale_inr).toFixed(2),
    mrp_inr: Number(product.recommended_retail_inr).toFixed(2),
    minimum_order_quantity: product.min_wholesale_qty,
    available_quantity: product.stock_quantity,
    specifications: {
      length_cm: product.dimensions_cm.length,
      width_cm: product.dimensions_cm.width,
      height_cm: product.dimensions_cm.height,
      weight_grams: product.dimensions_cm.weight_grams ?? null,
      material_description: product.description_en.slice(0, 500),
    },
    images: productImages(product),
    msme_artisan_declaration: {
      artisan_name: artisan.full_name,
      gi_tag_certified: artisan.gi_tag_certified,
      cluster: artisan.cluster_location,
    },
  };
}

/** WhatsApp-ready bilingual B2B pitch an artisan can forward to a buyer. */
export function toWhatsAppB2BMessage(product: Product): string {
  return [
    `*${product.title_hi}*`,
    product.title_en,
    '',
    `थोक भाव / Wholesale: ₹${product.recommended_wholesale_inr} (${product.min_wholesale_qty}+ pcs)`,
    `MRP: ₹${product.recommended_retail_inr}`,
    `स्टॉक / Stock: ${product.stock_quantity}`,
    product.hsn_code ? `HSN: ${product.hsn_code}` : '',
    '',
    product.description_en.slice(0, 400),
    '',
    product.enhanced_image_url,
    `SKU: ${product.sku}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const CHANNELS = ['ondc', 'gem', 'b2b'] as const;
type Channel = (typeof CHANNELS)[number];

export const marketplaceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/marketplace/listings - the bazaar: every artisan's products.
   *
   * Unlike the rest of this API this is deliberately NOT scoped to the caller -
   * seeing other artisans' work is the feature. What keeps it safe is that rows
   * only ever leave through `toPublicListing`, an explicit allowlist (see
   * listings.service.ts), and that it still requires a signed-in artisan.
   */
  fastify.get<{ Querystring: unknown }>('/listings', async (request, reply) => {
    const query = z
      .object({
        q: z.string().optional(),
        craft: z.string().trim().min(1).max(80).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      })
      .parse(request.query);

    const { data, error, count } = await queryListings((select) => {
      let builder = supabase()
        .from('products')
        .select(select, { count: 'exact' })
        .is('deleted_at', null);

      // One or() group per word; repeated groups are ANDed by PostgREST.
      for (const word of searchWords(query.q)) builder = builder.or(searchFilter(word));
      if (query.craft) builder = builder.eq('artisans.craft_category', query.craft);

      return builder
        .order('updated_at', { ascending: false })
        // Tie-break so a page boundary never repeats or skips rows that share a
        // timestamp (a bulk export touches many rows in the same millisecond).
        .order('id', { ascending: true })
        .range(query.offset, query.offset + query.limit - 1);
    });

    if (error) return reply.internalServerError(error.message);

    const listings = ((data ?? []) as unknown as ListingRow[])
      .map((row) => toPublicListing(row, request.artisanId))
      .filter((listing) => listing !== null);

    const total = count ?? listings.length;
    return reply.send({
      listings,
      total,
      offset: query.offset,
      has_more: query.offset + (data?.length ?? 0) < total,
    });
  });

  /** GET /v1/marketplace/listings/:id - one listing, same public projection. */
  fastify.get<{ Params: { id: string } }>('/listings/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const { data, error } = await queryListings((select) =>
      supabase()
        .from('products')
        .select(select)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle(),
    );

    if (error) return reply.internalServerError(error.message);

    const listing = data ? toPublicListing(data as unknown as ListingRow, request.artisanId) : null;
    if (!listing) return reply.notFound('listing not found');

    return reply.send({ listing });
  });

  /**
   * GET /v1/marketplace/crafts - filter chips for the bazaar.
   *
   * Counted from products, not artisans, so a chip never leads to an empty
   * list. Capped read: fine at this scale, and the place to switch to a SQL
   * `GROUP BY` view once the catalog outgrows it.
   */
  fastify.get('/crafts', async (_request, reply) => {
    const { data, error } = await supabase()
      .from('products')
      .select('artisans!inner(craft_category)')
      .is('deleted_at', null)
      .limit(5000);

    if (error) return reply.internalServerError(error.message);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as unknown as Array<{
      artisans: { craft_category: string } | null;
    }>) {
      const name = row.artisans?.craft_category;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const crafts = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return reply.send({ crafts });
  });

  /** POST /v1/marketplace/export - one-tap syndication payload builder. */
  fastify.post('/export', async (request, reply) => {
    const body = z
      .object({
        product_ids: z.array(z.string().uuid()).min(1).max(200),
        channels: z.array(z.enum(CHANNELS)).min(1),
      })
      .parse(request.body);

    const [{ data: artisan, error: artisanError }, { data: products, error: productError }] =
      await Promise.all([
        supabase()
          .from('artisans')
          .select('full_name, gi_tag_certified, cluster_location')
          .eq('id', (request.artisanId as string))
          .single(),
        supabase()
          .from('products')
          .select('*')
          .eq('artisan_id', (request.artisanId as string))
          .in('id', body.product_ids),
      ]);

    if (artisanError || !artisan) return reply.notFound('artisan not found');
    if (productError) return reply.internalServerError(productError.message);

    const rows = (products ?? []) as Product[];
    if (rows.length === 0) return reply.notFound('no matching products');

    const payload: Record<string, unknown> = {};
    if (body.channels.includes('ondc')) {
      payload.ondc = {
        context: { domain: 'ONDC:RET10', country: 'IND', city: 'std:080', version: '2.0.2' },
        message: {
          catalog: {
            'bpp/providers': [
              {
                id: (request.artisanId as string),
                descriptor: { name: artisan.full_name },
                items: rows.map((p) => toOndcItem(p, artisan.full_name)),
              },
            ],
          },
        },
      };
    }
    if (body.channels.includes('gem')) {
      payload.gem = { catalog_rows: rows.map((p) => toGemCatalogRow(p, artisan)) };
    }
    if (body.channels.includes('b2b')) {
      payload.b2b = {
        messages: rows.map((p) => ({ sku: p.sku, whatsapp_text: toWhatsAppB2BMessage(p) })),
      };
    }

    // Record the sync so the SplitBadgePill shows the live channel state.
    const statusPatch = Object.fromEntries(
      body.channels.map((channel: Channel) => [channel, true]),
    );

    await Promise.all(
      rows.map((product) =>
        supabase()
          .from('products')
          .update({
            marketplace_sync_status: { ...product.marketplace_sync_status, ...statusPatch },
            updated_at: new Date().toISOString(),
          })
          .eq('id', product.id)
          .eq('artisan_id', (request.artisanId as string)),
      ),
    );

    return reply.send({ exported_count: rows.length, channels: body.channels, payload });
  });

  /** GET /v1/marketplace/status - connected channel summary. */
  fastify.get('/status', async (request, reply) => {
    const { data, error } = await supabase()
      .from('products')
      .select('id, marketplace_sync_status')
      .eq('artisan_id', request.artisanId as string);

    if (error) return reply.internalServerError(error.message);

    const rows = data ?? [];
    const count = (channel: Channel): number =>
      rows.filter(
        (row) => (row.marketplace_sync_status as Record<string, boolean>)?.[channel] === true,
      ).length;

    return reply.send({
      total_products: rows.length,
      synced: { ondc: count('ondc'), gem: count('gem'), b2b: count('b2b') },
    });
  });

  /**
   * GET /v1/marketplace/inquiries
   *
   * Buyer messages arrive in English or Hindi; each one is translated into the
   * artisan's own language and voiced, because a wholesale inquiry the artisan
   * cannot read is a lost order.
   */
  fastify.get<{ Querystring: unknown }>(
    '/inquiries',
    async (request, reply) => {
      const query = z
        .object({
          language_code: z.string().default('hi-IN'),
          speak: z.coerce.boolean().default(false),
        })
        .parse(request.query);

      const { data, error } = await supabase()
        .from('buyer_inquiries')
        .select('*')
        .eq('artisan_id', request.artisanId as string)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) return reply.internalServerError(error.message);

      const inquiries = await Promise.all(
        (data ?? []).map(async (inquiry) => {
          let translated = inquiry.message_text as string;
          let audio: string | null = null;

          try {
            const result = await translateText({
              text: inquiry.message_text as string,
              sourceLanguageCode: (inquiry.source_language_code as string) ?? 'en-IN',
              targetLanguageCode: query.language_code,
            });
            translated = result.text || translated;

            if (query.speak) {
              const speech = await synthesizeSpeech({
                text: translated,
                languageCode: query.language_code as SupportedLanguage,
              });
              audio = speech.audio_base64;
            }
          } catch (translateError) {
            request.log.warn({ err: translateError }, 'inquiry translation failed');
          }

          return { ...inquiry, translated_text: translated, audio_base64: audio };
        }),
      );

      return reply.send({ inquiries });
    },
  );
};
