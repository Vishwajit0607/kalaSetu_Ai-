import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { editStudioPhoto, type StudioEngine, type StudioFallbackReason } from '../services/studio.service.js';
import {
  downloadMedia,
  removeMedia,
  storagePathFromUrl,
  supabase,
  uploadMedia,
} from '../services/supabase.service.js';
import { UpstreamError } from '../services/http.js';
import type { BackdropPreset } from '../types/index.js';

/** Photoroom API proxy + media storage. The API key never leaves the server. */

const BACKDROPS: BackdropPreset[] = [
  'marketplace-white',
  'warm-sandstone',
  'handloom-wood',
  'dark-editorial',
];

/**
 * Query-string booleans.
 *
 * NOT `z.coerce.boolean()`: that is `Boolean(value)`, and every non-empty
 * string is truthy, so `"false"` parsed as `true`. The studio's relight and
 * shadow toggles flipped in the UI and were ignored by the server.
 */
const queryBool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? fallback : value === 'true' || value === '1'));

const editQuerySchema = z.object({
  backdrop: z
    .enum(['marketplace-white', 'warm-sandstone', 'handloom-wood', 'dark-editorial'])
    .default('marketplace-white'),
  relight: queryBool(true),
  shadow: queryBool(true),
  /**
   * Re-edit an already-uploaded capture instead of uploading it again. The
   * studio re-runs the edit every time the artisan changes the backdrop or a
   * toggle; without this each change re-sent the photo and left another orphan
   * copy of it in storage.
   */
  raw_image_url: z.string().url().optional(),
  /** The enhanced image this edit replaces; deleted afterwards to avoid orphans. */
  previous_enhanced_url: z.string().url().optional(),
});

const removeSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(12),
});

export const visionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/backdrops', async () => ({ presets: BACKDROPS }));

  /**
   * POST /v1/vision/media/remove
   *
   * Discard photos the artisan took for a draft and then dropped (an extra
   * angle they removed). Only the caller's own raw/enhanced captures, and never
   * one a saved product still uses - those are skipped, not an error.
   */
  fastify.post('/media/remove', async (request, reply) => {
    const artisanId = request.artisanId as string;
    const { urls } = removeSchema.parse(request.body);

    const paths = new Map<string, string>(); // url -> storage path
    for (const url of urls) {
      const path = storagePathFromUrl(url, artisanId);
      if (path?.startsWith(`${artisanId}/raw/`) || path?.startsWith(`${artisanId}/enhanced/`)) {
        paths.set(url, path);
      }
    }

    // Anything a saved product points at stays.
    const candidates = [...paths.keys()];
    const inUse = new Set<string>();
    if (candidates.length > 0) {
      const list = candidates.map((url) => `"${url}"`).join(',');
      const { data } = await supabase()
        .from('products')
        .select('raw_image_url, enhanced_image_url')
        .eq('artisan_id', artisanId)
        .or(`raw_image_url.in.(${list}),enhanced_image_url.in.(${list})`);
      for (const row of data ?? []) {
        inUse.add(row.raw_image_url as string);
        inUse.add(row.enhanced_image_url as string);
      }
      // Gallery column may not exist yet; if so there is nothing to protect.
      const gallery = await supabase()
        .from('products')
        .select('gallery_image_urls')
        .eq('artisan_id', artisanId)
        .overlaps('gallery_image_urls', candidates);
      for (const row of gallery.data ?? []) {
        for (const url of (row.gallery_image_urls as string[] | null) ?? []) inUse.add(url);
      }
    }

    const doomed = candidates.filter((url) => !inUse.has(url)).map((url) => paths.get(url) as string);
    await removeMedia(doomed);
    return reply.send({ removed: doomed.length, kept: candidates.length - doomed.length });
  });

  /**
   * POST /v1/vision/edit
   *
   * Either a multipart `imageFile` (first capture) or `?raw_image_url=` (a
   * re-edit). Responds with hosted URLs, never image bytes: the phone shows
   * the result straight from storage and the catalog step passes the URL back,
   * so the megabyte-sized PNG does not cross the mobile link three times.
   *
   * Always synchronous - an artisan photographs one product at a time and the
   * HaloProductStage renders the cutout the moment this returns.
   */
  fastify.post('/edit', async (request, reply) => {
    const artisanId = request.artisanId as string;
    const query = editQuerySchema.parse(request.query);

    /* ---- 1. get the source image, and make sure it is stored ------------ */
    let source: Buffer;
    let mimeType: string;
    let rawUrl: string;

    if (query.raw_image_url) {
      const path = storagePathFromUrl(query.raw_image_url, artisanId);
      if (!path?.startsWith(`${artisanId}/raw/`)) {
        return reply.badRequest('raw_image_url must be one of your own uploaded captures');
      }
      source = await downloadMedia(path);
      mimeType = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      rawUrl = query.raw_image_url;
    } else {
      const file = await request.file({ limits: { fileSize: 15 * 1024 * 1024 } });
      if (!file) return reply.badRequest('multipart field "imageFile" is required');

      source = await file.toBuffer();
      mimeType = file.mimetype || 'image/jpeg';
      if (!mimeType.startsWith('image/')) {
        return reply.unsupportedMediaType(`expected an image, received ${mimeType}`);
      }

      const stored = await uploadMedia({
        artisanId,
        kind: 'raw',
        buffer: source,
        contentType: mimeType,
        extension: mimeType.includes('png') ? 'png' : 'jpg',
      });
      rawUrl = stored.publicUrl;
    }

    /* ---- 2. studio edit (Photoroom, else the local engine) --------------- */
    let enhancedUrl = rawUrl;
    let degraded = false;
    let width = 0;
    let height = 0;
    let applied: string[] = ['passthrough-fallback'];
    let engine: StudioEngine | 'none' = 'none';
    let fallbackReason: StudioFallbackReason | undefined;

    try {
      const edited = await editStudioPhoto({
        imageBuffer: source,
        filename: 'product.jpg',
        mimeType,
        backdrop: query.backdrop,
        relight: query.relight,
        shadow: query.shadow,
      });

      const enhanced = await uploadMedia({
        artisanId,
        kind: 'enhanced',
        buffer: edited.buffer,
        contentType: edited.contentType,
        extension: edited.extension,
      });

      enhancedUrl = enhanced.publicUrl;
      width = edited.width;
      height = edited.height;
      applied = edited.applied;
      engine = edited.engine;
      fallbackReason = edited.fallbackReason;
    } catch (error) {
      // Never strand the artisan mid-flow: if no studio engine worked, hand
      // back the original (already stored), flagged, so they can carry on and
      // re-run the edit later.
      if (!(error instanceof UpstreamError)) throw error;
      request.log.warn(
        { status: error.status, vendor: error.vendor },
        'studio edit unavailable, serving the original',
      );
      degraded = true;
    }

    /* ---- 3. tidy up the image this one replaces -------------------------- */
    if (!degraded && query.previous_enhanced_url) {
      const old = storagePathFromUrl(query.previous_enhanced_url, artisanId);
      // Only ever an enhanced render. After a degraded edit the "enhanced"
      // URL *is* the raw capture, which must not be deleted.
      if (old?.startsWith(`${artisanId}/enhanced/`)) {
        removeMedia([old]).catch((err: unknown) =>
          request.log.warn({ err }, 'could not remove the replaced studio image'),
        );
      }
    }

    return reply.send({
      raw_image_url: rawUrl,
      enhanced_image_url: enhancedUrl,
      width,
      height,
      applied,
      degraded,
      engine,
      fallback_reason: fallbackReason ?? null,
    });
  });
};
