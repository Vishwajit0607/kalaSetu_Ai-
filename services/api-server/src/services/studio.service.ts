import { Buffer } from 'node:buffer';
import { loadEnv } from '../config/env.js';
import { UpstreamError } from './http.js';
import { editProductPhoto, type StudioEditParams } from './photoroom.service.js';
import { localStudioEdit } from './local-studio.service.js';

/**
 * Chooses the engine that turns a phone snap into a studio shot.
 *
 *   photoroom  - best quality (AI relight, physically placed shadow), paid
 *   local      - free, in-process approximation (see local-studio.service.ts)
 *
 * `auto` tries Photoroom and falls back to local. A *quota* failure (402/403,
 * or 401 for a revoked key) is remembered for a while so every photo does not
 * first pay a round trip to learn what it already knows.
 */

export type StudioEngine = 'photoroom' | 'local';
/** Why the preferred engine was not used; undefined when it was. */
export type StudioFallbackReason = 'quota' | 'unavailable';

export interface StudioOutput {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
  applied: string[];
  engine: StudioEngine;
  fallbackReason?: StudioFallbackReason;
}

const QUOTA_STATUSES = new Set([401, 402, 403]);
/** Re-probe Photoroom this often after a quota failure (credits may be topped up). */
const QUOTA_RECHECK_MS = 10 * 60_000;
/** After an outage-type failure, skip it briefly rather than paying 3 retries each time. */
const OUTAGE_RECHECK_MS = 60_000;

let photoroomBlockedUntil = 0;
let photoroomBlockReason: StudioFallbackReason = 'quota';

/** Test hook. */
export function resetStudioState(): void {
  photoroomBlockedUntil = 0;
  photoroomBlockReason = 'quota';
}

async function viaPhotoroom(params: StudioEditParams): Promise<StudioOutput> {
  const edited = await editProductPhoto(params);
  return {
    buffer: Buffer.from(edited.image_base64, 'base64'),
    contentType: 'image/png',
    extension: 'png',
    width: edited.width,
    height: edited.height,
    applied: edited.applied,
    engine: 'photoroom',
  };
}

async function viaLocal(
  params: StudioEditParams,
  fallbackReason?: StudioFallbackReason,
): Promise<StudioOutput> {
  const edited = await localStudioEdit({
    imageBuffer: params.imageBuffer,
    backdrop: params.backdrop,
    relight: params.relight,
    shadow: params.shadow,
    size: params.maxSize,
  });
  return { ...edited, engine: 'local', fallbackReason };
}

/** Throws `UpstreamError` only when no engine could produce an image. */
export async function editStudioPhoto(params: StudioEditParams): Promise<StudioOutput> {
  const preference = loadEnv().STUDIO_ENGINE;

  if (preference === 'local') return viaLocal(params);
  if (preference === 'photoroom') return viaPhotoroom(params);

  // auto
  if (Date.now() < photoroomBlockedUntil) {
    return viaLocal(params, photoroomBlockReason);
  }

  try {
    return await viaPhotoroom(params);
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;

    const quota = QUOTA_STATUSES.has(error.status);
    photoroomBlockReason = quota ? 'quota' : 'unavailable';
    photoroomBlockedUntil = Date.now() + (quota ? QUOTA_RECHECK_MS : OUTAGE_RECHECK_MS);
    return viaLocal(params, photoroomBlockReason);
  }
}
