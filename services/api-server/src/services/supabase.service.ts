import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { UpstreamError } from './http.js';

/**
 * Supabase access with the service-role key. This process is the only writer
 * that bypasses RLS, so every query here must scope by `artisan_id` explicitly.
 */

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const env = loadEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export interface UploadResult {
  path: string;
  publicUrl: string;
}

/** Store a media blob (raw photo, studio cutout, voice note) and return its URL. */
export async function uploadMedia(params: {
  artisanId: string;
  kind: 'raw' | 'enhanced' | 'voice';
  buffer: Buffer;
  contentType: string;
  extension: string;
}): Promise<UploadResult> {
  const env = loadEnv();
  const path = `${params.artisanId}/${params.kind}/${randomUUID()}.${params.extension}`;

  const { error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .upload(path, params.buffer, {
      contentType: params.contentType,
      upsert: false,
      cacheControl: '31536000',
    });

  if (error) throw new UpstreamError('supabase-storage', 502, `upload failed: ${error.message}`);

  const { data } = supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(path);

  return { path, publicUrl: data.publicUrl };
}

/* ---------------------------------------------------------- media ownership */

/** Everything under `<artisan>/...` in the bucket belongs to that artisan. */
function publicPrefix(): string {
  const env = loadEnv();
  return `${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/`;
}

/**
 * Turn a public URL back into a storage path, but only if it points at one of
 * *this artisan's own* uploads. Returns null for anything else.
 *
 * Product creation used to accept any URL the client sent, and the client
 * sent on-device `file://` paths - so products were saved with images no
 * marketplace, and no other phone, could ever load. Requiring the URL to be
 * one this server handed out closes that, and also stops an artisan pointing a
 * product at another artisan's photo.
 */
export function storagePathFromUrl(url: string, artisanId: string): string | null {
  const prefix = publicPrefix();
  if (!url.startsWith(prefix)) return null;

  const path = decodeURIComponent(url.slice(prefix.length).split('?')[0] ?? '');
  // No traversal, and must sit inside the caller's own folder.
  if (path.includes('..') || !path.startsWith(`${artisanId}/`)) return null;
  return path;
}

export async function downloadMedia(path: string): Promise<Buffer> {
  const env = loadEnv();
  const { data, error } = await supabase().storage.from(env.SUPABASE_STORAGE_BUCKET).download(path);
  if (error || !data) {
    throw new UpstreamError('supabase-storage', 502, `download failed: ${error?.message ?? 'no data'}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeMedia(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const env = loadEnv();
  const { error } = await supabase().storage.from(env.SUPABASE_STORAGE_BUCKET).remove(paths);
  if (error) throw new Error(`Supabase storage remove failed: ${error.message}`);
}

/** Remove every object an artisan owns. Used by account deletion. */
export async function removeAllMediaFor(artisanId: string): Promise<void> {
  const env = loadEnv();
  const bucket = supabase().storage.from(env.SUPABASE_STORAGE_BUCKET);

  for (const folder of ['raw', 'enhanced', 'voice']) {
    // list() is paginated; loop until a page comes back empty.
    for (;;) {
      const { data, error } = await bucket.list(`${artisanId}/${folder}`, { limit: 100 });
      if (error) throw new Error(`Supabase storage list failed: ${error.message}`);
      if (!data || data.length === 0) break;
      await removeMedia(data.map((entry) => `${artisanId}/${folder}/${entry.name}`));
      if (data.length < 100) break;
    }
  }
}

/**
 * SKU generator: readable at a trade fair, unique per artisan.
 * e.g. KS-BAN-7F3A21 for a Banarasi weaver.
 */
export function generateSku(craftCategory: string): string {
  const prefix = craftCategory
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `KS-${prefix}-${suffix}`;
}
