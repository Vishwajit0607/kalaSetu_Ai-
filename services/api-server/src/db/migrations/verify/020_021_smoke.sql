-- Smoke test for migrations 020-021 (the product price history).
--
-- HOW TO USE: after applying 020 and 021, paste this whole file into the Supabase SQL
-- Editor and run it. It succeeds if the last message is
--   "ALL CHECKS PASSED"
-- and fails loudly with "FAIL: <what>" otherwise.
--
-- SAFE: it creates its own throwaway artisans and products inside a transaction and
-- ends with ROLLBACK, so nothing it creates survives. (This file is NOT a migration:
-- it lives in verify/ and is never run by `npm run db:migrate`.)

BEGIN;

DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  pa UUID := gen_random_uuid();   -- a's product
  pb UUID := gen_random_uuid();   -- b's product
  n INTEGER;
BEGIN
  INSERT INTO artisans (id, phone_number, full_name, craft_category)
  VALUES (a, '+0' || substr(replace(a::text, '-', ''), 1, 10), 'Smoke A', 'pottery'),
         (b, '+0' || substr(replace(b::text, '-', ''), 1, 10), 'Smoke B', 'weaving');

  INSERT INTO products (id, artisan_id, sku, raw_image_url, enhanced_image_url, title_en, title_hi,
                        description_en, description_hi, material_cost_inr, labor_hours, dimensions_cm,
                        recommended_retail_inr, recommended_wholesale_inr)
  VALUES (pa, a, 'SMOKE-A-' || substr(pa::text, 1, 6), 'r', 'e', 'Pot', 'p', 'd', 'd', 1, 1, '{}', 500, 300),
         (pb, b, 'SMOKE-B-' || substr(pb::text, 1, 6), 'r', 'e', 'Jug', 'j', 'd', 'd', 1, 1, '{}', 900, 600);

  -- 021: the trigger ------------------------------------------------------------
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pa AND source = 'create';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: creating a product must record its starting price'; END IF;

  UPDATE products SET title_en = 'Renamed', stock_quantity = 7 WHERE id = pa;
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pa;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: a change that leaves the price alone must write no history (found %)', n; END IF;

  UPDATE products SET recommended_retail_inr = 550 WHERE id = pa;
  UPDATE products SET recommended_wholesale_inr = 320 WHERE id = pa;
  UPDATE products SET recommended_retail_inr = 550, recommended_wholesale_inr = 320 WHERE id = pa;  -- same values
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pa AND source = 'edit';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: two real price changes must give exactly 2 edit rows, found %', n; END IF;

  -- 020/021: the table's own rules ------------------------------------------------
  BEGIN
    INSERT INTO product_price_history (product_id, retail_inr, wholesale_inr, source) VALUES (pa, 1, 1, 'hacked');
    RAISE EXCEPTION 'FAIL: an unknown source must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'product_price_history_product_time_idx') THEN
    RAISE EXCEPTION 'FAIL: the (product, time) index is missing';
  END IF;

  -- security ---------------------------------------------------------------------
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'product_price_history'::regclass) THEN
    RAISE EXCEPTION 'FAIL: row-level security is not enabled on product_price_history';
  END IF;

  IF has_table_privilege('authenticated', 'product_price_history', 'INSERT')
     OR has_table_privilege('authenticated', 'product_price_history', 'UPDATE')
     OR has_table_privilege('authenticated', 'product_price_history', 'DELETE')
     OR has_table_privilege('anon', 'product_price_history', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users must not be able to write or erase price history';
  END IF;

  -- Act as artisan a, as the API would for a signed-in user: sees only their own product's history.
  GRANT SELECT ON products, product_price_history TO authenticated;   -- Supabase grants these by default; rolled back below
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pb;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: artisan A must not see artisan B''s price history, saw % rows', n; END IF;

  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pa;
  RESET ROLE;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL: artisan A should see their own 3 rows, saw %', n; END IF;

  -- cascade -----------------------------------------------------------------------
  DELETE FROM products WHERE id = pa;
  SELECT count(*) INTO n FROM product_price_history WHERE product_id = pa;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: deleting the product must delete its history'; END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END
$$;

ROLLBACK;
