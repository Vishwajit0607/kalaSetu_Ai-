-- Developer 2 / milestone 1: a history of every price a product has had.
--
-- A product's price lives in two columns on `products`, and editing it overwrote the
-- old value for good. That loses the answer to "what did I charge last month?", which
-- is exactly what an artisan needs when a buyer says "you quoted me less before".
--
-- One row per price a product has held:
--   retail_inr / wholesale_inr   the two prices at that moment
--   source                       create (listed), edit (changed later), system (backfilled)
--   changed_at                   when it took effect
--
-- The trigger that fills this table (and the index it needs) come in migration 021 in
-- the next step of this module; this file only creates the table.
-- Rows go when their product goes (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS product_price_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retail_inr     NUMERIC(10, 2) NOT NULL CHECK (retail_inr >= 0),
  wholesale_inr  NUMERIC(10, 2) NOT NULL CHECK (wholesale_inr >= 0),
  source         VARCHAR(16) NOT NULL DEFAULT 'edit'
                 CHECK (source IN ('create', 'edit', 'system')),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
