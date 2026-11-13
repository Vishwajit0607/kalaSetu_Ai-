import { Model } from '@nozbe/watermelondb';
import { field, text, date, json } from '@nozbe/watermelondb/decorators';
import type { DimensionsCm } from '@/services/apiClient';

/**
 * WatermelonDB models. The `json` decorator needs a sanitiser, so each one
 * validates shape on read - a corrupted row from an interrupted write must
 * degrade to a default, never crash the inventory grid.
 */

const sanitizeTags = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string') : [];

const sanitizeDimensions = (raw: unknown): DimensionsCm => {
  const value = (raw ?? {}) as Partial<DimensionsCm>;
  return {
    length: Number(value.length) || 0,
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    ...(value.weight_grams !== undefined ? { weight_grams: Number(value.weight_grams) } : {}),
  };
};

const sanitizeSyncStatus = (raw: unknown): { ondc: boolean; gem: boolean; b2b: boolean } => {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ondc: value.ondc === true,
    gem: value.gem === true,
    b2b: value.b2b === true,
  };
};

const sanitizePayload = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

export class ArtisanModel extends Model {
  static override table = 'artisans';

  @text('server_id') serverId!: string;
  @text('phone_number') phoneNumber!: string;
  @text('full_name') fullName!: string;
  @text('preferred_language') preferredLanguage!: string;
  @text('craft_category') craftCategory!: string;
  @text('cluster_location') clusterLocation!: string | null;
  @field('gi_tag_certified') giTagCertified!: boolean;
  @date('created_at') createdAt!: Date;
}

export class ProductModel extends Model {
  static override table = 'products';

  @text('server_id') serverId!: string | null;
  @text('artisan_id') artisanId!: string;
  @text('sku') sku!: string;

  @text('raw_image_uri') rawImageUri!: string;
  @text('enhanced_image_uri') enhancedImageUri!: string | null;
  @text('raw_image_url') rawImageUrl!: string | null;
  @text('enhanced_image_url') enhancedImageUrl!: string | null;
  @text('voice_note_uri') voiceNoteUri!: string | null;
  @text('voice_note_url') voiceNoteUrl!: string | null;

  @text('native_transcript') nativeTranscript!: string | null;
  @text('title_en') titleEn!: string;
  @text('title_hi') titleHi!: string;
  @text('description_en') descriptionEn!: string;
  @text('description_hi') descriptionHi!: string;
  @json('seo_tags', sanitizeTags) seoTags!: string[];
  @text('hsn_code') hsnCode!: string | null;

  @field('material_cost_inr') materialCostInr!: number;
  @field('labor_hours') laborHours!: number;
  @json('dimensions_cm', sanitizeDimensions) dimensionsCm!: DimensionsCm;

  @field('recommended_retail_inr') recommendedRetailInr!: number;
  @field('recommended_wholesale_inr') recommendedWholesaleInr!: number;
  @field('min_wholesale_qty') minWholesaleQty!: number;
  @field('stock_quantity') stockQuantity!: number;

  @json('marketplace_sync_status', sanitizeSyncStatus) marketplaceSyncStatus!: {
    ondc: boolean;
    gem: boolean;
    b2b: boolean;
  };

  @text('ai_status') aiStatus!: 'draft' | 'pending_ai' | 'ready' | 'failed';
  @field('pending_media') pendingMedia!: boolean;

  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  /** The image to show: enhanced cutout if it exists, else the raw capture. */
  get displayImageUri(): string {
    return this.enhancedImageUrl ?? this.enhancedImageUri ?? this.rawImageUri;
  }

  get isLowStock(): boolean {
    return this.stockQuantity <= 3;
  }
}

export class StockMovementModel extends Model {
  static override table = 'stock_movements';

  @text('server_id') serverId!: string | null;
  @text('product_id') productId!: string;
  @text('artisan_id') artisanId!: string;
  @field('delta') delta!: number;
  @field('resulting_quantity') resultingQuantity!: number;
  @text('reason') reason!: string;
  @text('voice_transcript') voiceTranscript!: string | null;
  @field('synced') synced!: boolean;
  @date('created_at') createdAt!: Date;
}

export class BuyerInquiryModel extends Model {
  static override table = 'buyer_inquiries';

  @text('server_id') serverId!: string;
  @text('artisan_id') artisanId!: string;
  @text('product_id') productId!: string | null;
  @text('buyer_name') buyerName!: string;
  @text('buyer_company') buyerCompany!: string | null;
  @text('message_text') messageText!: string;
  @text('translated_text') translatedText!: string | null;
  @text('source_language_code') sourceLanguageCode!: string;
  @field('requested_quantity') requestedQuantity!: number | null;
  @field('offered_price_inr') offeredPriceInr!: number | null;
  @text('channel') channel!: string;
  @text('status') status!: string;
  @date('created_at') createdAt!: Date;
}

export class SyncQueueModel extends Model {
  static override table = 'sync_queue';

  @text('kind') kind!: string;
  @json('payload', sanitizePayload) payload!: Record<string, unknown>;
  @text('local_product_id') localProductId!: string | null;
  @field('attempts') attempts!: number;
  @text('last_error') lastError!: string | null;
  @field('next_attempt_at') nextAttemptAt!: number;
  @date('created_at') createdAt!: Date;
}
