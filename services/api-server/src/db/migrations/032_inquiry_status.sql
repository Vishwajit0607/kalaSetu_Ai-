-- Nikhil Telkar / milestone 3: buyer artisan identity, status audit and indexes.
--
-- Previously, inquiries had only a recipient (artisan_id) and status was an
-- unchecked VARCHAR with no audit timestamp. This migration adds:
--   1. buyer_artisan_id: links the inquiry to the registered sender (from verified JWT)
--   2. status_updated_at: timestamp tracking when inquiry state changed
--   3. status constraint: strictly enforces ('new', 'replied', 'won', 'lost')
--   4. filtered indexes: for fast inbox filtering by status and sent inquiries

ALTER TABLE buyer_inquiries
  ADD COLUMN IF NOT EXISTS buyer_artisan_id UUID REFERENCES artisans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buyer_inquiries_status_check'
  ) THEN
    ALTER TABLE buyer_inquiries
      ADD CONSTRAINT buyer_inquiries_status_check
      CHECK (status IN ('new', 'replied', 'won', 'lost'));
  END IF;
END $$;

-- Fast index for the artisan's inbox filtering by status (new/replied/won/lost)
CREATE INDEX IF NOT EXISTS buyer_inquiries_artisan_status_idx
  ON buyer_inquiries (artisan_id, status, created_at DESC);

-- Fast index for looking up inquiries sent by this artisan to other sellers
CREATE INDEX IF NOT EXISTS buyer_inquiries_buyer_artisan_idx
  ON buyer_inquiries (buyer_artisan_id, created_at DESC)
  WHERE buyer_artisan_id IS NOT NULL;

-- Allow artisans to view inquiries they sent as a buyer
DROP POLICY IF EXISTS inquiries_buyer_access ON buyer_inquiries;
CREATE POLICY inquiries_buyer_access ON buyer_inquiries
  FOR SELECT USING (auth.uid() = buyer_artisan_id);
