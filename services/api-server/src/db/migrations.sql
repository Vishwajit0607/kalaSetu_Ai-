-- KalaSetu AI - PostgreSQL schema (Supabase)
-- Run with: npm run db:migrate --workspace=@kalasetu/api-server

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Artisans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artisans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(15) UNIQUE NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  preferred_language VARCHAR(10) DEFAULT 'hi-IN',
  craft_category VARCHAR(80) NOT NULL,
  cluster_location VARCHAR(120),
  gi_tag_certified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id UUID REFERENCES artisans(id) ON DELETE CASCADE,
  sku VARCHAR(40) UNIQUE NOT NULL,
  raw_image_url TEXT NOT NULL,
  enhanced_image_url TEXT NOT NULL,
  voice_note_url TEXT,
  native_transcript TEXT,
  title_en VARCHAR(200) NOT NULL,
  title_hi VARCHAR(200) NOT NULL,
  description_en TEXT NOT NULL,
  description_hi TEXT NOT NULL,
  seo_tags TEXT[] DEFAULT '{}',
  hsn_code VARCHAR(20),
  material_cost_inr NUMERIC(10, 2) NOT NULL,
  labor_hours NUMERIC(6, 1) NOT NULL,
  dimensions_cm JSONB NOT NULL,
  recommended_retail_inr NUMERIC(10, 2) NOT NULL,
  recommended_wholesale_inr NUMERIC(10, 2) NOT NULL,
  min_wholesale_qty INTEGER DEFAULT 5,
  stock_quantity INTEGER DEFAULT 1,
  marketplace_sync_status JSONB DEFAULT '{"ondc": false, "gem": false, "b2b": false}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- The inventory grid and the WatermelonDB delta sync are the two hot reads.
CREATE INDEX IF NOT EXISTS products_artisan_updated_idx
  ON products (artisan_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS products_low_stock_idx
  ON products (artisan_id, stock_quantity)
  WHERE stock_quantity <= 3;

-- ---------------------------------------------------------------------------
-- Buyer inquiries (B2B feed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id UUID REFERENCES artisans(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  buyer_name VARCHAR(120) NOT NULL,
  buyer_company VARCHAR(160),
  buyer_phone VARCHAR(20),
  channel VARCHAR(16) NOT NULL DEFAULT 'b2b',  -- ondc | gem | b2b
  message_text TEXT NOT NULL,
  source_language_code VARCHAR(10) DEFAULT 'en-IN',
  requested_quantity INTEGER,
  offered_price_inr NUMERIC(10, 2),
  status VARCHAR(16) NOT NULL DEFAULT 'new',   -- new | replied | won | lost
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS buyer_inquiries_artisan_idx
  ON buyer_inquiries (artisan_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Stock ledger - every voice adjustment is auditable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  artisan_id UUID REFERENCES artisans(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  resulting_quantity INTEGER NOT NULL,
  reason VARCHAR(32) NOT NULL DEFAULT 'voice',  -- voice | manual | order | sync
  voice_transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_movements_product_idx
  ON stock_movements (product_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Soft-delete column used by the WatermelonDB pull endpoint
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (delta sync correctness depends on this)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_touch_updated_at ON products;
CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: an artisan sees only their own rows.
-- The API server uses the service-role key and bypasses these policies; the
-- mobile client talks to Supabase directly with the anon key and does not.
-- ---------------------------------------------------------------------------
ALTER TABLE artisans ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artisans_self_access ON artisans;
CREATE POLICY artisans_self_access ON artisans
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS products_owner_access ON products;
CREATE POLICY products_owner_access ON products
  FOR ALL USING (auth.uid() = artisan_id) WITH CHECK (auth.uid() = artisan_id);

DROP POLICY IF EXISTS inquiries_owner_access ON buyer_inquiries;
CREATE POLICY inquiries_owner_access ON buyer_inquiries
  FOR ALL USING (auth.uid() = artisan_id) WITH CHECK (auth.uid() = artisan_id);

DROP POLICY IF EXISTS movements_owner_access ON stock_movements;
CREATE POLICY movements_owner_access ON stock_movements
  FOR ALL USING (auth.uid() = artisan_id) WITH CHECK (auth.uid() = artisan_id);

-- ---------------------------------------------------------------------------
-- Bazaar: newest listings across every artisan
-- GET /v1/marketplace/listings pages through all live products by recency, so
-- it needs an index that is not prefixed by artisan_id. Idempotent, and the
-- endpoint works (just slower on a large catalog) before it is applied.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS products_market_idx
  ON products (updated_at DESC, id)
  WHERE deleted_at IS NULL;
