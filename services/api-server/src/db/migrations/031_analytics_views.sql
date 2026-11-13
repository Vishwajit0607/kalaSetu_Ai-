-- Nikhil Telkar / milestone 2: inventory summary and daily movements views.
--
-- Until now, the inventory dashboard fetched every product row over the network
-- and aggregated stock value and counts in Node.js.
--
-- These PostgreSQL views push the aggregation directly into the database:
--   1. v_artisan_inventory_summary: per-artisan active inventory rollups
--   2. v_daily_stock_movements: daily sales/adjustments grouped by Indian calendar day (Asia/Kolkata)
--
-- An index on (artisan_id, created_at DESC) ensures fast historical range queries.

CREATE INDEX IF NOT EXISTS stock_movements_artisan_created_idx
  ON stock_movements (artisan_id, created_at DESC);

CREATE OR REPLACE VIEW v_artisan_inventory_summary AS
SELECT
  p.artisan_id,
  COUNT(p.id)::INTEGER AS total_products,
  COALESCE(SUM(p.stock_quantity), 0)::INTEGER AS total_stock_units,
  COALESCE(SUM(p.stock_quantity * p.recommended_retail_inr), 0)::NUMERIC(12, 2) AS total_inventory_value_retail,
  COALESCE(SUM(p.stock_quantity * p.recommended_wholesale_inr), 0)::NUMERIC(12, 2) AS total_inventory_value_wholesale,
  COUNT(CASE WHEN p.stock_quantity <= 3 THEN 1 END)::INTEGER AS low_stock_count,
  COUNT(CASE WHEN p.stock_quantity = 0 THEN 1 END)::INTEGER AS out_of_stock_count
FROM products p
WHERE p.deleted_at IS NULL
GROUP BY p.artisan_id;

CREATE OR REPLACE VIEW v_daily_stock_movements AS
SELECT
  sm.artisan_id,
  (sm.created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS movement_date,
  sm.reason,
  COUNT(*)::INTEGER AS movement_count,
  COALESCE(SUM(sm.delta), 0)::INTEGER AS total_delta,
  COALESCE(SUM(CASE WHEN sm.delta > 0 THEN sm.delta ELSE 0 END), 0)::INTEGER AS units_added,
  COALESCE(SUM(CASE WHEN sm.delta < 0 THEN -sm.delta ELSE 0 END), 0)::INTEGER AS units_sold_or_removed
FROM stock_movements sm
GROUP BY
  sm.artisan_id,
  (sm.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
  sm.reason;
