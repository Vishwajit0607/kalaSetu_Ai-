import { Buffer } from 'node:buffer';
import { PHOTOROOM_EDIT_URL, loadEnv } from '../config/env.js';
import { fetchWithRetry } from './http.js';
import type { BackdropPreset, StudioEditResult } from '../types/index.js';

/**
 * Photoroom Image Editing API v2 wrapper.
 *
 * Craft photos arrive underexposed - shot indoors on a loom floor with a
 * sub-GBP 80 Android handset - so every edit requests AI relighting and a soft
 * contact shadow in addition to background removal. That combination is what
 * turns a dim phone snap into a marketplace-grade studio cutout.
 */

export interface StudioEditParams {
  imageBuffer: Buffer;
  filename: string;
  mimeType: string;
  backdrop: BackdropPreset;
  relight: boolean;
  shadow: boolean;
  /** Longest output edge in px; marketplaces want >= 1600 for zoom. */
  maxSize?: number;
}

const BACKDROP_BACKGROUND: Record<BackdropPreset, string> = {
  'marketplace-white': '#FFFFFF',
  'warm-sandstone': '#E7D3B3',
  'handloom-wood': '#6B4A2B',
  'dark-editorial': '#060705',
};

/** ONDC and GeM listing images must be square with generous padding. */
const OUTPUT_PADDING = '0.08';

export async function editProductPhoto(
  params: StudioEditParams,
): Promise<StudioEditResult> {
  const env = loadEnv();
  const maxSize = params.maxSize ?? 1600;

  const form = new FormData();
  form.append(
    'imageFile',
    new Blob([new Uint8Array(params.imageBuffer)], { type: params.mimeType }),
    params.filename,
  );

  // Segmentation + framing
  form.append('background.color', BACKDROP_BACKGROUND[params.backdrop]);
  form.append('padding', OUTPUT_PADDING);
  form.append('maxWidth', String(maxSize));
  form.append('maxHeight', String(maxSize));
  form.append('outputSize', `${maxSize}x${maxSize}`);
  form.append('export.format', 'png');

  const applied = ['background-removal'];

  if (params.relight) {
    // AI relight rescues the underexposed indoor craft photos.
    form.append('lighting.mode', 'ai.auto');
    applied.push('ai-relight');
  }

  if (params.shadow) {
    form.append('shadow.mode', 'ai.soft');
    applied.push('soft-shadow');
  }

  if (params.backdrop !== 'marketplace-white') {
    applied.push(`backdrop:${params.backdrop}`);
  }

  const response = await fetchWithRetry(
    PHOTOROOM_EDIT_URL,
    {
      method: 'POST',
      headers: {
        'x-api-key': env.PHOTOROOM_API_KEY,
        Accept: 'image/png, application/json',
      },
      body: form,
    },
    { vendor: 'photoroom', attempts: 3, timeoutMs: 60_000 },
  );

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    image_base64: buffer.toString('base64'),
    width: Number(response.headers.get('x-width') ?? maxSize),
    height: Number(response.headers.get('x-height') ?? maxSize),
    applied,
  };
}

/**
 * Offline / quota fallback: hand the original frame back untouched so the
 * artisan can still finish cataloguing. The caller flags the product so the
 * mobile app's own offline outbox (apps/mobile/services/offlineQueue.ts)
 * re-runs the studio edit once connectivity returns.
 */
export function passthroughEdit(imageBuffer: Buffer): StudioEditResult {
  return {
    image_base64: imageBuffer.toString('base64'),
    width: 0,
    height: 0,
    applied: ['passthrough-fallback'],
  };
}
