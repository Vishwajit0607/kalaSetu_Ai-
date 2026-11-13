import Constants from 'expo-constants';
import { tFor } from '@/i18n/translate';
import {
  expireSession,
  getLanguage,
  getSession,
  isExpiringSoon,
  saveSession,
  type Session,
} from './session';

/**
 * Typed client for the KalaSetu API server.
 *
 * Every failure surfaces as a structured `ApiError` carrying `spokenHi` - a
 * sentence the UI reads aloud in the artisan's language (the field keeps its
 * old name; it is no longer always Hindi). Silent failure is the one outcome
 * this app cannot afford: an artisan who hears nothing assumes the phone ate
 * their work.
 *
 * Auth: every call carries the access token. It is refreshed shortly before it
 * expires, and once if the server answers 401 anyway. Only a *definitive* 401
 * from the refresh endpoint ends the session - a phone that is simply offline
 * must never be logged out for it.
 */

const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:8080';

export class ApiError extends Error {
  readonly status: number;
  readonly spokenHi: string;
  readonly code: string;

  constructor(status: number, code: string, message: string, spokenHi: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.spokenHi = spokenHi;
  }
}

/** True when the failure is the phone's connection, not the server's answer. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'offline';
}

/* --------------------------------------------------------------- transport */

interface RequestOptions {
  /** Attach the access token. Default true; the auth endpoints turn it off. */
  auth?: boolean;
}

async function send<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  auth: boolean,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t = tFor(getLanguage());

  const session = auth ? getSession() : null;

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Lang': getLanguage(),
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string; spoken_hi?: string }
        | null;
      throw new ApiError(
        response.status,
        payload?.error ?? 'request_failed',
        payload?.message ?? `Request to ${path} failed with ${response.status}`,
        payload?.spoken_hi ?? t('err.generic'),
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // A timeout and a dead connection are different failures with different
    // advice, and neither may claim work was "saved on the phone" - it was not.
    // `fetch` rejects with a TypeError when there is no route at all; an abort
    // is our own timer firing on a connection that exists but is too slow.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'request timed out', t('err.timeout'));
    }
    throw new ApiError(0, 'offline', String(error), t('err.offline'));
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------- refresh */

let refreshing: Promise<Session | null> | null = null;

async function performRefresh(refreshToken: string): Promise<Session | null> {
  try {
    const response = await fetch(`${BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lang': getLanguage() },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    // The one case that ends a session: the server says the refresh token
    // itself is no good. Anything else (5xx, rate limit, no network) leaves the
    // session intact so the user is not logged out by a bad connection.
    if (response.status === 401) {
      expireSession();
      return null;
    }
    if (!response.ok) return null;

    const data = (await response.json()) as { session: ApiSession };
    const next = toSession(data.session);
    await saveSession(next);
    return next;
  } catch {
    return null;
  }
}

/** Single-flight: concurrent requests share one refresh instead of racing it. */
function refreshSession(): Promise<Session | null> {
  const current = getSession();
  if (!current) return Promise.resolve(null);
  if (!refreshing) {
    refreshing = performRefresh(current.refreshToken).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
  options: RequestOptions = {},
): Promise<T> {
  const auth = options.auth ?? true;

  if (auth) {
    const session = getSession();
    if (session && isExpiringSoon(session)) await refreshSession();
  }

  try {
    return await send<T>(path, init, timeoutMs, auth);
  } catch (error) {
    // One retry on 401, with a freshly refreshed token. A refresh that fails
    // definitively has already ended the session via expireSession().
    if (auth && error instanceof ApiError && error.status === 401 && getSession()) {
      const fresh = await refreshSession();
      if (fresh) return send<T>(path, init, timeoutMs, auth);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------- types */

export interface ApiSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function toSession(session: ApiSession): Session {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}

export interface ArtisanRow {
  id: string;
  phone_number: string;
  full_name: string;
  preferred_language: string;
  craft_category: string;
  cluster_location: string | null;
  gi_tag_certified: boolean;
}

export interface AuthResult {
  session: ApiSession;
  artisan: ArtisanRow;
}

export interface DimensionsCm {
  length: number;
  width: number;
  height: number;
  weight_grams?: number;
}

export interface PricingBreakdown {
  material_cost_inr: number;
  labor_cost_inr: number;
  packaging_cost_inr: number;
  base_cost_inr: number;
  skill_rate_inr_per_hour: number;
  complexity_score: number;
  wholesale_margin: number;
  retail_margin: number;
  recommended_wholesale_inr: number;
  recommended_retail_inr: number;
  wholesale_profit_inr: number;
  retail_profit_inr: number;
  competitor_band_inr: { low: number; high: number };
  source: 'deterministic' | 'ai-benchmarked';
}

export interface CatalogGeneration {
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string;
  craft_complexity_score: number;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  pricing_rationale: string;
}

/** Hosted URLs, never bytes: see the vision route on the server. */
export interface StudioEditResult {
  raw_image_url: string;
  enhanced_image_url: string;
  width: number;
  height: number;
  applied: string[];
  /** True only when no studio engine could process the photo; the original is returned. */
  degraded: boolean;
  /** Which engine produced the image: Photoroom, or the free built-in one. */
  engine: 'photoroom' | 'local' | 'none';
  /** Why the preferred engine was skipped, if it was. */
  fallback_reason: 'quota' | 'unavailable' | null;
}

export interface ProductRow {
  id: string;
  artisan_id: string;
  sku: string;
  raw_image_url: string;
  enhanced_image_url: string;
  /** Extra angles after the cover; absent on products saved before multi-photo. */
  gallery_image_urls?: string[];
  /** Only on a just-saved product that had extras: false if they could not be stored. */
  gallery_saved?: boolean;
  voice_note_url?: string | null;
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string | null;
  stock_quantity: number;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  min_wholesale_qty: number;
  marketplace_sync_status: { ondc: boolean; gem: boolean; b2b: boolean };
  dimensions_cm: DimensionsCm;
  updated_at: string;
}

/**
 * Another artisan's product, as the bazaar shows it. Mirrors the server's
 * `PublicListing`: no cost price, labour hours, raw photo or phone number -
 * those never leave the server for anyone but the owner.
 */
export interface PublicListing {
  id: string;
  sku: string;
  enhanced_image_url: string;
  /** Extra angles after the cover; absent from an older server. */
  gallery_image_urls?: string[];
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string | null;
  dimensions_cm: DimensionsCm;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  min_wholesale_qty: number;
  stock_quantity: number;
  updated_at: string;
  /** True for the signed-in artisan's own products. */
  is_mine: boolean;
  seller: {
    id: string;
    full_name: string;
    craft_category: string;
    cluster_location: string | null;
    gi_tag_certified: boolean;
  };
}

export interface ListingsPage {
  listings: PublicListing[];
  total: number;
  offset: number;
  has_more: boolean;
}

export const LISTINGS_PAGE_SIZE = 20;

export interface CommitProductBody {
  raw_image_url: string;
  enhanced_image_url: string;
  gallery_image_urls?: string[];
  voice_note_url: string | null;
  native_transcript: string | null;
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  seo_tags: string[];
  hsn_code: string | null;
  material_cost_inr: number;
  labor_hours: number;
  dimensions_cm: DimensionsCm;
  recommended_retail_inr: number;
  recommended_wholesale_inr: number;
  stock_quantity: number;
}

/* --------------------------------------------------------------- endpoints */

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/* ------------------------------------------------------------------------
 * Account security: activity trail, password change, data export
 * --------------------------------------------------------------------- */

export type AuthEventType = 'signup' | 'login' | 'login_failed' | 'logout' | 'password_changed';

export interface AuthEvent {
  id: string;
  event_type: AuthEventType;
  /** Already masked by the server (203.0.113.x). */
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ActivityPage {
  events: AuthEvent[];
  /** Pass as `before` for the next (older) page; null when there is none. */
  next_before: string | null;
}

/** Everything stored about the signed-in artisan. */
export interface DataExport {
  exported_at: string;
  artisan: ArtisanRow;
  products: unknown[];
  stock_movements: unknown[];
  inquiries_received: unknown[];
  inquiries_sent: unknown[];
  security_events: unknown[];
  /** Lists that were cut at the server's row cap. */
  truncated: string[];
  counts: Record<string, number>;
}

export const api = {
  health: () => request<{ status: string }>('/health', {}, 6000, { auth: false }),

  /* Accounts */
  signup: (body: {
    phone: string;
    password: string;
    full_name: string;
    craft_category: string;
    cluster_location?: string | null;
    preferred_language: string;
  }) => request<AuthResult>('/v1/auth/signup', json(body), 30_000, { auth: false }),

  login: (body: { phone: string; password: string }) =>
    request<AuthResult>('/v1/auth/login', json(body), 30_000, { auth: false }),

  me: () => request<{ artisan: ArtisanRow }>('/v1/me'),

  updateMe: (body: {
    full_name?: string;
    craft_category?: string;
    cluster_location?: string | null;
    preferred_language?: string;
  }) => request<{ artisan: ArtisanRow }>('/v1/me', { method: 'PATCH', body: JSON.stringify(body) }),

  deleteAccount: () => request<void>('/v1/me', { method: 'DELETE' }, 60_000),

  /**
   * End the session on the server too, so the token cannot be reused. Short
   * timeout: the caller signs out on the phone regardless of how this goes.
   */
  logout: (allDevices = false) =>
    request<void>('/v1/auth/logout', json({ all_devices: allDevices }), 8_000),

  /** A wrong current password comes back as a 400 (never a 401, which would log the artisan out). */
  changePassword: (body: { current_password: string; new_password: string }) =>
    request<{ changed: true; spoken_hi: string }>('/v1/me/password', json(body)),

  /** The artisan's own security trail, newest first. */
  activity: (params: { limit?: number; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.before) query.set('before', params.before);
    const qs = query.toString();
    return request<ActivityPage>(`/v1/me/activity${qs ? `?${qs}` : ''}`);
  },

  /** Everything stored about the artisan, as one JSON document. */
  exportMyData: () => request<DataExport>('/v1/me/export', {}, 60_000),

  /* Studio: either a fresh capture (fileUri) or a re-edit of an uploaded one. */
  editPhoto: (params: {
    fileUri?: string;
    rawImageUrl?: string;
    previousEnhancedUrl?: string;
    backdrop: string;
    relight: boolean;
    shadow: boolean;
  }) => {
    const query = new URLSearchParams({
      backdrop: params.backdrop,
      relight: String(params.relight),
      shadow: String(params.shadow),
    });
    if (params.rawImageUrl) query.set('raw_image_url', params.rawImageUrl);
    if (params.previousEnhancedUrl) query.set('previous_enhanced_url', params.previousEnhancedUrl);

    let body: FormData | undefined;
    if (!params.rawImageUrl && params.fileUri) {
      body = new FormData();
      // React Native's FormData accepts this { uri, name, type } shape natively.
      body.append('imageFile', {
        uri: params.fileUri,
        name: 'product.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
    }

    return request<StudioEditResult>(
      `/v1/vision/edit?${query.toString()}`,
      { method: 'POST', ...(body ? { body } : {}) },
      90_000,
    );
  },

  /** Discard photos the artisan took for a draft and then dropped. Best effort. */
  removeMedia: (urls: string[]) =>
    request<{ removed: number; kept: number }>('/v1/vision/media/remove', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }),

  /* Speech */
  transcribe: (params: { fileUri: string; languageCode?: string; store?: boolean }) => {
    const form = new FormData();
    // `audio/mp4` is the registered type for the AAC-in-MP4 the recorder makes.
    // `audio/m4a` looks right but is not a media type, and Sarvam 400s on it.
    form.append('file', {
      uri: params.fileUri,
      name: 'voice.m4a',
      type: 'audio/mp4',
    } as unknown as Blob);

    const query = new URLSearchParams();
    if (params.languageCode) query.set('language_code', params.languageCode);
    if (params.store) query.set('store', 'true');
    const qs = query.toString();

    return request<{
      transcript: string;
      language_code: string;
      voice_note_url: string | null;
    }>(`/v1/speech/transcribe${qs ? `?${qs}` : ''}`, { method: 'POST', body: form }, 60_000, {
      // Optional-auth route: the onboarding screens call it before an account
      // exists, and it recognises a signed-in caller by the token when present.
      auth: getSession() !== null,
    });
  },

  bilingual: (body: { text: string; source_language_code: string }) =>
    request<{ hindi: string; english: string }>('/v1/speech/bilingual', json(body), 30_000, {
      auth: getSession() !== null,
    }),

  speak: (body: { text: string; language_code: string; pace?: number }) =>
    request<{ audio_base64: string }>('/v1/speech/speak', json(body), 12_000, {
      auth: getSession() !== null,
    }),

  /* Catalog + pricing. Always synchronous - see the server's catalog routes. */
  generateCatalog: (body: {
    enhanced_image_url: string;
    native_transcript?: string;
    language_code: string;
  }) =>
    request<{ catalog: CatalogGeneration; pricing: PricingBreakdown | null; degraded: boolean }>(
      '/v1/catalog/generate',
      json(body),
      // Gemini normally answers in seconds, but when it is overloaded the
      // server falls through to a slower model that queues. 120s covers the
      // server's own worst case (~17s + 75s) with room to spare.
      120_000,
    ),

  price: (body: {
    material_cost_inr: number;
    labor_hours: number;
    dimensions_cm: DimensionsCm;
    complexity_score?: number;
    ai_retail_inr?: number;
    ai_wholesale_inr?: number;
    language_code: string;
  }) => request<{ breakdown: PricingBreakdown; rationale: string }>('/v1/catalog/price', json(body)),

  commitProduct: (body: CommitProductBody) => request<ProductRow>('/v1/catalog/products', json(body)),

  /* Inventory: always the signed-in artisan's own - no id in any URL. */
  inventory: () =>
    request<{
      products: ProductRow[];
      low_stock: ProductRow[];
      total_skus: number;
      stock_value_inr: number;
    }>('/v1/inventory'),

  adjustStock: (productId: string, body: { delta?: number; quantity?: number }) =>
    request<{ product: ProductRow; low_stock: boolean }>(`/v1/inventory/${productId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  voiceAdjustStock: (body: { transcript: string; language_code: string }) =>
    request<{
      matched: boolean;
      product_id?: string;
      sku?: string;
      quantity_sold?: number;
      stock_quantity?: number;
      low_stock?: boolean;
      spoken_confirmation: string;
      candidates?: Array<{ id: string; sku: string; title_hi: string }>;
    }>('/v1/inventory/voice-adjust', json(body)),

  productQr: (productId: string) =>
    request<{
      sku: string;
      title_en: string;
      wholesale_inr: number;
      retail_inr: number;
      qr_png_data_url: string;
    }>(`/v1/inventory/${productId}/qr`),

  lowStockAlert: (body: { language_code: string }) =>
    request<{
      low_stock_count: number;
      items: Array<{ sku: string; title_hi: string; stock_quantity: number }>;
      spoken_text?: string;
      audio_base64: string | null;
    }>('/v1/inventory/low-stock-alert', json(body)),

  /* Bazaar: every artisan's products, not just the signed-in one's. */
  listings: (params: { q?: string; craft?: string | null; offset?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    const q = params.q?.trim();
    if (q) query.set('q', q);
    if (params.craft) query.set('craft', params.craft);
    query.set('limit', String(params.limit ?? LISTINGS_PAGE_SIZE));
    query.set('offset', String(params.offset ?? 0));
    return request<ListingsPage>(`/v1/marketplace/listings?${query.toString()}`);
  },

  listing: (id: string) =>
    request<{ listing: PublicListing }>(`/v1/marketplace/listings/${encodeURIComponent(id)}`),

  crafts: () =>
    request<{ crafts: Array<{ name: string; count: number }> }>('/v1/marketplace/crafts'),

  /* Marketplaces */
  exportToMarketplaces: (body: { product_ids: string[]; channels: Array<'ondc' | 'gem' | 'b2b'> }) =>
    request<{ exported_count: number; channels: string[]; payload: Record<string, unknown> }>(
      '/v1/marketplace/export',
      json(body),
      60_000,
    ),

  marketplaceStatus: () =>
    request<{ total_products: number; synced: { ondc: number; gem: number; b2b: number } }>(
      '/v1/marketplace/status',
    ),

  inquiries: (languageCode: string, speak = false) =>
    request<{
      inquiries: Array<{
        id: string;
        buyer_name: string;
        buyer_company: string | null;
        message_text: string;
        translated_text: string;
        requested_quantity: number | null;
        offered_price_inr: number | null;
        channel: string;
        status: string;
        created_at: string;
        audio_base64: string | null;
      }>;
    }>(`/v1/marketplace/inquiries?language_code=${encodeURIComponent(languageCode)}&speak=${speak}`),
};

export { BASE_URL };
