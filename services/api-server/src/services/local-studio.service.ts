import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { UpstreamError } from './http.js';
import type { BackdropPreset } from '../types/index.js';

/**
 * Free, in-process "studio" - the fallback for when Photoroom is out of credits
 * or down.
 *
 *   photo -> background removal (ONNX, runs on this machine) -> optional relight
 *         -> trim to the product -> centre on a square backdrop with a soft
 *         drop shadow -> JPEG
 *
 * It is an approximation of Photoroom, not a clone: the cutout is good, the
 * lighting is a global tone correction rather than AI relighting, and the
 * shadow is a blurred silhouette rather than a physically placed one. It exists
 * so that "make my photo look like a studio shot" keeps working when a paid
 * vendor's quota runs out, instead of silently returning the original.
 */

export interface LocalStudioParams {
  imageBuffer: Buffer;
  backdrop: BackdropPreset;
  relight: boolean;
  shadow: boolean;
  /** Output is a square of this many px. */
  size?: number;
}

export interface LocalStudioResult {
  buffer: Buffer;
  contentType: 'image/jpeg';
  extension: 'jpg';
  width: number;
  height: number;
  applied: string[];
}

const BACKDROP_COLOR: Record<BackdropPreset, string> = {
  'marketplace-white': '#FFFFFF',
  'warm-sandstone': '#E7D3B3',
  'handloom-wood': '#6B4A2B',
  'dark-editorial': '#060705',
};

/** Marketplaces want the product centred with generous margins. */
const PADDING = 0.08;
/** Longest edge fed to the segmentation model; more pixels only cost time. */
const SEGMENT_EDGE = 1280;

/**
 * Background removal is CPU-heavy (~3 s, ~400 MB peak). One at a time, with a
 * short queue; beyond that we shed load - the route then returns the original
 * photo, flagged, instead of letting a burst of uploads exhaust the machine.
 */
const MAX_CONCURRENT = 1;
const MAX_QUEUED = 4;
let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return;
  }
  if (waiting.length >= MAX_QUEUED) {
    throw new UpstreamError('local-studio', 503, 'studio is busy, try again shortly');
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next(); // hand the slot straight over; `running` stays the same
  else running -= 1;
}

type RemoveBackground = typeof import('@imgly/background-removal-node').removeBackground;
let loader: Promise<{ removeBackground: RemoveBackground; publicPath: string }> | null = null;

/**
 * Loaded lazily so the server (and the test suite) never pays for the ONNX
 * runtime unless an edit actually needs it.
 *
 * `publicPath` is passed explicitly: the library resolves its model files
 * relative to the process cwd by default, which is wrong under npm workspace
 * hoisting (the package lives in the repo-root node_modules).
 */
function loadSegmenter() {
  loader ??= import('@imgly/background-removal-node').then((mod) => {
    const entry = createRequire(import.meta.url).resolve('@imgly/background-removal-node');
    return {
      removeBackground: mod.removeBackground,
      publicPath: pathToFileURL(`${dirname(entry)}/`).href,
    };
  });
  // A failed load must not poison every later request.
  loader.catch(() => {
    loader = null;
  });
  return loader;
}

/** Transparent-PNG cutout of the product, or throws. */
export async function cutOut(imageBuffer: Buffer): Promise<Buffer> {
  // Bake in EXIF rotation (phones store portrait shots sideways + a flag) and
  // cap the size. The segmenter ignores EXIF, so skipping this cuts out a
  // sideways image.
  const normalised = await sharp(imageBuffer)
    .rotate()
    .resize(SEGMENT_EDGE, SEGMENT_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();

  const { removeBackground, publicPath } = await loadSegmenter();
  const blob = await removeBackground(new Blob([new Uint8Array(normalised)], { type: 'image/jpeg' }), {
    publicPath,
    model: process.env.STUDIO_LOCAL_MODEL === 'small' ? 'small' : 'medium',
    output: { format: 'image/png' },
  });
  return Buffer.from(await blob.arrayBuffer());
}

/**
 * Lift an underexposed product. Craft photos are shot indoors on cheap
 * handsets, so this is mostly "a bit brighter, a bit more contrast" - applied
 * only as much as the photo needs, measured on the product's own pixels (not
 * the backdrop, which is about to be replaced).
 */
async function relightCutout(cutout: Buffer): Promise<{ image: Buffer; gamma: number }> {
  const { data, info } = await sharp(cutout)
    .resize(128, 128, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! > 200) {
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      count += 1;
    }
  }
  const mean = count > 0 ? sum / count : 128;

  // A brightness multiplier (not sharp's gamma(), which is meant to wrap a
  // resize and darkens when used alone). Dark-by-nature products - a black
  // phone, dark wood - are capped low so they don't wash out to grey.
  const gamma = mean >= 130 ? 1 : Math.min(1.4, 1 + (130 - mean) / 160);
  if (gamma === 1) return { image: cutout, gamma };

  const meta = await sharp(cutout).metadata();
  const raw = { width: meta.width!, height: meta.height!, channels: 1 as const };
  const alpha = await sharp(cutout).ensureAlpha().extractChannel(3).raw().toBuffer();
  const rgb = await sharp(cutout).removeAlpha().modulate({ brightness: gamma }).linear(1.06, -4).png().toBuffer();
  const image = await sharp(rgb).joinChannel(alpha, { raw }).png().toBuffer();
  return { image, gamma };
}

/**
 * A soft silhouette of the product, offset slightly downward, to sit it on the
 * surface. Drawn on a full-size canvas so the blur is never clipped at the
 * product's own bounding box.
 */
async function dropShadow(
  product: Buffer,
  size: number,
  left: number,
  top: number,
  opacity: number,
): Promise<Buffer> {
  const silhouette = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: product, left, top }])
    .extractChannel(3)
    .blur(Math.max(4, size / 50))
    .linear(opacity, 0)
    .raw()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } })
    .joinChannel(silhouette, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer();
}

/** Subtle centre-lit gradient so coloured backdrops read as a lit surface. */
function vignette(size: number, color: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <defs><radialGradient id="g" cx="50%" cy="46%" r="75%">
         <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
         <stop offset="60%" stop-color="${color}" stop-opacity="0"/>
         <stop offset="100%" stop-color="#000000" stop-opacity="0.16"/>
       </radialGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>
     </svg>`,
  );
}

export async function localStudioEdit(params: LocalStudioParams): Promise<LocalStudioResult> {
  const size = params.size ?? 1600;
  const color = BACKDROP_COLOR[params.backdrop];
  const applied = ['background-removal'];

  await acquire();
  let cutout: Buffer;
  try {
    cutout = await cutOut(params.imageBuffer);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(
      'local-studio',
      500,
      error instanceof Error ? error.message : 'background removal failed',
    );
  } finally {
    release();
  }

  try {
    if (params.relight) {
      const lit = await relightCutout(cutout);
      cutout = lit.image;
      if (lit.gamma > 1) applied.push('relight');
    }

    // Crop to the product, then fit inside the padded square.
    const box = Math.round(size * (1 - 2 * PADDING));
    const product = await sharp(cutout)
      .trim({ threshold: 8 })
      .resize(box, box, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = product.info;
    const left = Math.round((size - width) / 2);
    // Sit very slightly below centre so the shadow has room above the edge.
    const top = Math.round((size - height) / 2 + size * 0.01);

    const layers: sharp.OverlayOptions[] = [];

    if (params.backdrop !== 'marketplace-white') {
      layers.push({ input: vignette(size, color), left: 0, top: 0 });
    }

    if (params.shadow) {
      // Dark backdrops swallow a black shadow, so it is only a faint hint there.
      const opacity = params.backdrop === 'dark-editorial' ? 0.0 : 0.32;
      if (opacity > 0) {
        const offset = Math.round(size * 0.02);
        layers.push({
          input: await dropShadow(product.data, size, left, top + offset, opacity),
          left: 0,
          top: 0,
        });
        applied.push('soft-shadow');
      }
    }

    layers.push({ input: product.data, left, top });

    const buffer = await sharp({
      create: { width: size, height: size, channels: 3, background: color },
    })
      .composite(layers)
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    if (params.backdrop !== 'marketplace-white') applied.push(`backdrop:${params.backdrop}`);
    applied.push('local-engine');

    return { buffer, contentType: 'image/jpeg', extension: 'jpg', width: size, height: size, applied };
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(
      'local-studio',
      500,
      error instanceof Error ? error.message : 'studio compositing failed',
    );
  }
}
