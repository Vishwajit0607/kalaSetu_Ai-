/** Shared domain contracts, mirrored by apps/mobile/db/schema.ts. */

/** The two languages the product supports. */
export type SupportedLanguage = 'hi-IN' | 'en-IN';

export interface Artisan {
  id: string;
  phone_number: string;
  full_name: string;
  preferred_language: SupportedLanguage;
  craft_category: string;
  cluster_location: string | null;
  gi_tag_certified: boolean;
  created_at: string;
}

export interface DimensionsCm {
  length: number;
  width: number;
  height: number;
  weight_grams?: number;
}

export interface MarketplaceSyncStatus {
  ondc: boolean;
  gem: boolean;
  b2b: boolean;
}

export interface Product {
  id: string;
  artisan_id: string;
  sku: string;
  raw_image_url: string;
  enhanced_image_url: string;
  /** Extra angles after the cover. Absent on rows created before multi-photo. */
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
  min_wholesale_qty: number;
  stock_quantity: number;
  marketplace_sync_status: MarketplaceSyncStatus;
  updated_at: string;
}

/** Gemini 2.5 Flash structured output contract. */
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

export interface TranscriptionResult {
  transcript: string;
  language_code: SupportedLanguage;
  model: string;
  duration_seconds: number | null;
}

export interface TranslationResult {
  text: string;
  source_language_code: string;
  target_language_code: string;
}

export interface SpeechSynthesisResult {
  /** base64 WAV payload, directly playable by expo-av. */
  audio_base64: string;
  language_code: string;
  model: string;
}

export interface StudioEditResult {
  /** base64 PNG with alpha channel preserved. */
  image_base64: string;
  width: number;
  height: number;
  applied: string[];
}

export type BackdropPreset =
  | 'marketplace-white'
  | 'warm-sandstone'
  | 'handloom-wood'
  | 'dark-editorial';
