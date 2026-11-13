import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * WatermelonDB offline schema.
 *
 * This is the artisan's real catalog - the Postgres copy is a replica of it,
 * not the other way round. A weaver in a Bhagalpur cluster may be offline for
 * a full working day, photograph eleven products, record eleven voice notes
 * and sell four pieces, all before the phone sees a tower. Every one of those
 * actions has to land here first and reconcile later.
 *
 * Columns mirror services/api-server/src/db/migrations.sql, plus three
 * local-only fields WatermelonDB sync needs: `server_id`, `ai_status` and
 * `pending_media`.
 */
export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'artisans',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'phone_number', type: 'string', isIndexed: true },
        { name: 'full_name', type: 'string' },
        { name: 'preferred_language', type: 'string' },
        { name: 'craft_category', type: 'string' },
        { name: 'cluster_location', type: 'string', isOptional: true },
        { name: 'gi_tag_certified', type: 'boolean' },
        { name: 'created_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'products',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'artisan_id', type: 'string', isIndexed: true },
        { name: 'sku', type: 'string', isIndexed: true },

        /* Media: local file URIs until the sync engine uploads them. */
        { name: 'raw_image_uri', type: 'string' },
        { name: 'enhanced_image_uri', type: 'string', isOptional: true },
        { name: 'raw_image_url', type: 'string', isOptional: true },
        { name: 'enhanced_image_url', type: 'string', isOptional: true },
        { name: 'voice_note_uri', type: 'string', isOptional: true },
        { name: 'voice_note_url', type: 'string', isOptional: true },

        { name: 'native_transcript', type: 'string', isOptional: true },
        { name: 'title_en', type: 'string' },
        { name: 'title_hi', type: 'string' },
        { name: 'description_en', type: 'string' },
        { name: 'description_hi', type: 'string' },
        /* JSON-encoded string[] - Watermelon has no array column type. */
        { name: 'seo_tags', type: 'string' },
        { name: 'hsn_code', type: 'string', isOptional: true },

        { name: 'material_cost_inr', type: 'number' },
        { name: 'labor_hours', type: 'number' },
        /* JSON-encoded DimensionsCm. */
        { name: 'dimensions_cm', type: 'string' },

        { name: 'recommended_retail_inr', type: 'number' },
        { name: 'recommended_wholesale_inr', type: 'number' },
        { name: 'min_wholesale_qty', type: 'number' },
        { name: 'stock_quantity', type: 'number', isIndexed: true },

        /* JSON-encoded MarketplaceSyncStatus. */
        { name: 'marketplace_sync_status', type: 'string' },

        /**
         * Local-only: 'draft' | 'pending_ai' | 'ready' | 'failed'.
         * A product captured offline is 'pending_ai' until Photoroom and
         * Gemini have both run against it.
         */
        { name: 'ai_status', type: 'string', isIndexed: true },
        /** Whether raw/voice media still needs uploading. */
        { name: 'pending_media', type: 'boolean', isIndexed: true },

        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'stock_movements',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'artisan_id', type: 'string', isIndexed: true },
        { name: 'delta', type: 'number' },
        { name: 'resulting_quantity', type: 'number' },
        { name: 'reason', type: 'string' },
        { name: 'voice_transcript', type: 'string', isOptional: true },
        { name: 'synced', type: 'boolean', isIndexed: true },
        { name: 'created_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'buyer_inquiries',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'artisan_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isOptional: true },
        { name: 'buyer_name', type: 'string' },
        { name: 'buyer_company', type: 'string', isOptional: true },
        { name: 'message_text', type: 'string' },
        { name: 'translated_text', type: 'string', isOptional: true },
        { name: 'source_language_code', type: 'string' },
        { name: 'requested_quantity', type: 'number', isOptional: true },
        { name: 'offered_price_inr', type: 'number', isOptional: true },
        { name: 'channel', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'created_at', type: 'number' },
      ],
    }),

    /**
     * Durable outbox for work that needs the network: media uploads, AI jobs,
     * stock deltas and marketplace exports. Survives force-quit and reboot.
     */
    tableSchema({
      name: 'sync_queue',
      columns: [
        { name: 'kind', type: 'string', isIndexed: true },
        /* JSON-encoded job payload. */
        { name: 'payload', type: 'string' },
        { name: 'local_product_id', type: 'string', isOptional: true },
        { name: 'attempts', type: 'number' },
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'next_attempt_at', type: 'number', isIndexed: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
