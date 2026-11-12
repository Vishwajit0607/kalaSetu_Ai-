import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { resetEnvCache } from '../config/env.js';
import { UpstreamError } from '../services/http.js';

/**
 * The ONNX model is stubbed: these tests are about what we do around the
 * cutout (engine choice, fallback, compositing), not about the model, and the
 * real one costs seconds per call.
 */
vi.mock('@imgly/background-removal-node', () => ({
  removeBackground: vi.fn(async () => {
    // A 400x300 opaque dark-orange ellipse on a transparent canvas.
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">
         <ellipse cx="250" cy="200" rx="200" ry="150" fill="#5a2a10"/></svg>`,
    );
    const png = await sharp(svg).png().toBuffer();
    return new Blob([new Uint8Array(png)], { type: 'image/png' });
  }),
}));

vi.mock('../services/photoroom.service.js', () => ({
  editProductPhoto: vi.fn(),
}));

import { editProductPhoto } from '../services/photoroom.service.js';
import { editStudioPhoto, resetStudioState } from '../services/studio.service.js';
import { localStudioEdit } from '../services/local-studio.service.js';

const photoroom = vi.mocked(editProductPhoto);

async function sampleJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 800, channels: 3, background: '#2a6b6b' } })
    .jpeg()
    .toBuffer();
}

const params = async () => ({
  imageBuffer: await sampleJpeg(),
  filename: 'p.jpg',
  mimeType: 'image/jpeg',
  backdrop: 'marketplace-white' as const,
  relight: true,
  shadow: true,
});

const photoroomOk = {
  image_base64: Buffer.from('png-bytes').toString('base64'),
  width: 1600,
  height: 1600,
  applied: ['background-removal', 'ai-relight'],
};

beforeEach(() => {
  photoroom.mockReset();
  resetStudioState();
  delete process.env.STUDIO_ENGINE;
  resetEnvCache();
});

describe('editStudioPhoto engine selection', () => {
  it('uses Photoroom when it works', async () => {
    photoroom.mockResolvedValue(photoroomOk);
    const out = await editStudioPhoto(await params());
    expect(out.engine).toBe('photoroom');
    expect(out.fallbackReason).toBeUndefined();
    expect(out.contentType).toBe('image/png');
  });

  it('falls back to the local engine when Photoroom is out of credits (402)', async () => {
    photoroom.mockRejectedValue(new UpstreamError('photoroom', 402, 'no credits'));
    const out = await editStudioPhoto(await params());
    expect(out.engine).toBe('local');
    expect(out.fallbackReason).toBe('quota');
    expect(out.contentType).toBe('image/jpeg');
    expect(out.applied).toContain('local-engine');
  });

  it('remembers a quota failure instead of paying a round trip per photo', async () => {
    photoroom.mockRejectedValue(new UpstreamError('photoroom', 402, 'no credits'));
    await editStudioPhoto(await params());
    await editStudioPhoto(await params());
    await editStudioPhoto(await params());
    expect(photoroom).toHaveBeenCalledTimes(1);
  });

  it('reports an outage differently from a quota failure', async () => {
    photoroom.mockRejectedValue(new UpstreamError('photoroom', 503, 'down'));
    const out = await editStudioPhoto(await params());
    expect(out.engine).toBe('local');
    expect(out.fallbackReason).toBe('unavailable');
  });

  it('does not swallow programming errors as a vendor failure', async () => {
    photoroom.mockRejectedValue(new TypeError('boom'));
    await expect(editStudioPhoto(await params())).rejects.toBeInstanceOf(TypeError);
  });

  it('STUDIO_ENGINE=local never calls Photoroom', async () => {
    process.env.STUDIO_ENGINE = 'local';
    resetEnvCache();
    const out = await editStudioPhoto(await params());
    expect(out.engine).toBe('local');
    expect(photoroom).not.toHaveBeenCalled();
  });

  it('STUDIO_ENGINE=photoroom does not fall back', async () => {
    process.env.STUDIO_ENGINE = 'photoroom';
    resetEnvCache();
    photoroom.mockRejectedValue(new UpstreamError('photoroom', 402, 'no credits'));
    await expect(editStudioPhoto(await params())).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('localStudioEdit', () => {
  it('produces a square studio JPEG with the product centred on the backdrop', async () => {
    const out = await localStudioEdit({
      imageBuffer: await sampleJpeg(),
      backdrop: 'marketplace-white',
      relight: false,
      shadow: true,
      size: 800,
    });

    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([800, 800, 'jpeg']);

    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));

    // corner is the white backdrop, centre is the (dark) product
    expect(px(5, 5).every((v) => v > 245)).toBe(true);
    expect(px(400, 400).every((v) => v < 140)).toBe(true);
    expect(out.applied).toEqual(expect.arrayContaining(['background-removal', 'soft-shadow', 'local-engine']));
  });

  it('paints the requested backdrop colour', async () => {
    const out = await localStudioEdit({
      imageBuffer: await sampleJpeg(),
      backdrop: 'warm-sandstone',
      relight: false,
      shadow: false,
      size: 400,
    });
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const i = (3 * info.width + 3) * info.channels;
    // sandstone #E7D3B3 (with a faint vignette): warm, light, red > green > blue
    expect(data[i]!).toBeGreaterThan(data[i + 1]!);
    expect(data[i + 1]!).toBeGreaterThan(data[i + 2]!);
    expect(out.applied).toContain('backdrop:warm-sandstone');
    expect(out.applied).not.toContain('soft-shadow');
  });

  it('brightens an underexposed product only when relight is on', async () => {
    const run = async (relight: boolean) => {
      const out = await localStudioEdit({
        imageBuffer: await sampleJpeg(),
        backdrop: 'marketplace-white',
        relight,
        shadow: false,
        size: 400,
      });
      const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
      const i = (200 * info.width + 200) * info.channels;
      return { lum: data[i]! + data[i + 1]! + data[i + 2]!, applied: out.applied };
    };
    const off = await run(false);
    const on = await run(true);
    expect(on.lum).toBeGreaterThan(off.lum);
    expect(on.applied).toContain('relight');
    expect(off.applied).not.toContain('relight');
  });
});
