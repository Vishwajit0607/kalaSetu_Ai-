-- Smoke test for migrations 030-032 (stock ledger, analytics views, inquiry status).
--
-- HOW TO USE: after applying 030, 031 and 032 in the Supabase SQL Editor, paste
-- this whole file and run it. It succeeds if the last message is
--   "ALL CHECKS PASSED"
-- and fails loudly with "FAIL: <what>" otherwise.
--
-- SAFE: everything runs inside a transaction that ends with ROLLBACK, so nothing
-- it creates survives. (This file is NOT a migration: it lives in verify/ and is
-- never run by `npm run db:migrate`.)

BEGIN;

DO $$
DECLARE
  artisan_a UUID := gen_random_uuid();
  artisan_b UUID := gen_random_uuid();
  prod_id   UUID := gen_random_uuid();
  prod_b    UUID := gen_random_uuid();
  inq_id    UUID;
  n         INTEGER;
  v_result  RECORD;
BEGIN
  -- Seed two artisans and a product for artisan A
  INSERT INTO artisans (id, phone_number, full_name, craft_category)
  VALUES (artisan_a, '+0' || substr(replace(artisan_a::text, '-', ''), 1, 10), 'Smoke A', 'pottery'),
         (artisan_b, '+0' || substr(replace(artisan_b::text, '-', ''), 1, 10), 'Smoke B', 'weaving');

  INSERT INTO products (id, artisan_id, sku, title_en, title_hi, description_en, description_hi,
                        seo_tags, hsn_code, material_cost_inr, labor_hours, dimensions_cm,
                        recommended_retail_inr, recommended_wholesale_inr, min_wholesale_qty,
                        stock_quantity)
  VALUES (prod_id, artisan_a, 'KS-SMK-AAA111',
          'Smoke Test Saree', 'स्मोक टेस्ट साड़ी', '', '',
          ARRAY['saree'], '5208', 400, 6, '{"length":550,"width":110,"height":1}',
          1980, 1300, 5, 20);

  INSERT INTO products (id, artisan_id, sku, title_en, title_hi, description_en, description_hi,
                        seo_tags, hsn_code, material_cost_inr, labor_hours, dimensions_cm,
                        recommended_retail_inr, recommended_wholesale_inr, min_wholesale_qty,
                        stock_quantity)
  VALUES (prod_b, artisan_b, 'KS-SMK-BBB222',
          'Smoke Toy', 'स्मोक खिलौना', '', '',
          ARRAY['toy'], '9503', 100, 2, '{"length":10,"width":5,"height":5}',
          500, 350, 10, 5);

  -- ===== 030: adjust_stock function =========================================

  -- 1. The function must exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'adjust_stock'
  ) THEN
    RAISE EXCEPTION 'FAIL: adjust_stock function does not exist';
  END IF;

  -- 2. Positive delta works
  SELECT * INTO v_result
  FROM adjust_stock(prod_id, artisan_a, p_delta := 5, p_reason := 'manual');
  IF v_result.previous_quantity <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected previous_quantity 20, got %', v_result.previous_quantity;
  END IF;
  IF v_result.resulting_quantity <> 25 THEN
    RAISE EXCEPTION 'FAIL: expected resulting_quantity 25, got %', v_result.resulting_quantity;
  END IF;

  -- 3. Negative delta works
  SELECT * INTO v_result
  FROM adjust_stock(prod_id, artisan_a, p_delta := -3, p_reason := 'voice', p_voice_transcript := 'तीन साड़ी बिक गईं');
  IF v_result.resulting_quantity <> 22 THEN
    RAISE EXCEPTION 'FAIL: expected resulting_quantity 22, got %', v_result.resulting_quantity;
  END IF;

  -- 4. Set absolute quantity works
  SELECT * INTO v_result
  FROM adjust_stock(prod_id, artisan_a, p_set_quantity := 10, p_reason := 'sync');
  IF v_result.resulting_quantity <> 10 THEN
    RAISE EXCEPTION 'FAIL: expected resulting_quantity 10 after set, got %', v_result.resulting_quantity;
  END IF;

  -- 5. Going below zero must be rejected
  BEGIN
    PERFORM adjust_stock(prod_id, artisan_a, p_delta := -999, p_reason := 'manual');
    RAISE EXCEPTION 'FAIL: adjust_stock must reject stock going below zero';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INSUFFICIENT_STOCK%' THEN
      RAISE EXCEPTION 'FAIL: expected INSUFFICIENT_STOCK, got: %', SQLERRM;
    END IF;
  END;

  -- 6. Wrong artisan must be rejected (identity isolation)
  BEGIN
    PERFORM adjust_stock(prod_id, artisan_b, p_delta := 1, p_reason := 'manual');
    RAISE EXCEPTION 'FAIL: adjust_stock must reject a product not owned by the artisan';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%PRODUCT_NOT_FOUND%' THEN
      RAISE EXCEPTION 'FAIL: expected PRODUCT_NOT_FOUND, got: %', SQLERRM;
    END IF;
  END;

  -- 7. Invalid reason must be rejected
  BEGIN
    PERFORM adjust_stock(prod_id, artisan_a, p_delta := 1, p_reason := 'theft');
    RAISE EXCEPTION 'FAIL: adjust_stock must reject an invalid reason';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%INVALID_REASON%' THEN
      RAISE EXCEPTION 'FAIL: expected INVALID_REASON, got: %', SQLERRM;
    END IF;
  END;

  -- 8. The reason CHECK constraint on stock_movements rejects bad values
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_reason_check'
  ) THEN
    RAISE EXCEPTION 'FAIL: stock_movements_reason_check constraint is missing';
  END IF;

  -- 9. stock_movements rows were created by adjust_stock
  SELECT count(*) INTO n FROM stock_movements WHERE product_id = prod_id;
  IF n < 3 THEN
    RAISE EXCEPTION 'FAIL: expected at least 3 stock_movements rows, got %', n;
  END IF;

  -- 10. Public roles cannot call adjust_stock
  IF has_function_privilege('anon', 'adjust_stock(UUID,UUID,INTEGER,INTEGER,VARCHAR,TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon should NOT have EXECUTE on adjust_stock';
  END IF;

  -- ===== 031: analytics views ===============================================

  -- 11. The inventory summary view exists and shows artisan A
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_artisan_inventory_summary') THEN
    RAISE EXCEPTION 'FAIL: v_artisan_inventory_summary view does not exist';
  END IF;
  SELECT total_products, total_stock_units INTO n, v_result.resulting_quantity
  FROM v_artisan_inventory_summary WHERE artisan_id = artisan_a;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: artisan A should have 1 product in summary, got %', n;
  END IF;

  -- 12. The daily stock movements view exists
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_daily_stock_movements') THEN
    RAISE EXCEPTION 'FAIL: v_daily_stock_movements view does not exist';
  END IF;
  SELECT count(*) INTO n FROM v_daily_stock_movements WHERE artisan_id = artisan_a;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: expected at least 1 daily movement row for artisan A, got %', n;
  END IF;

  -- 13. The artisan+time index exists
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'stock_movements_artisan_created_idx') THEN
    RAISE EXCEPTION 'FAIL: stock_movements_artisan_created_idx index is missing';
  END IF;

  -- ===== 032: inquiry status ================================================

  -- 14. buyer_artisan_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buyer_inquiries' AND column_name = 'buyer_artisan_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: buyer_inquiries.buyer_artisan_id column is missing';
  END IF;

  -- 15. status_updated_at column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buyer_inquiries' AND column_name = 'status_updated_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: buyer_inquiries.status_updated_at column is missing';
  END IF;

  -- 16. Status CHECK constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buyer_inquiries_status_check'
  ) THEN
    RAISE EXCEPTION 'FAIL: buyer_inquiries_status_check constraint is missing';
  END IF;

  -- 17. Create a valid inquiry and update its status
  INSERT INTO buyer_inquiries (artisan_id, buyer_artisan_id, product_name, message, status)
  VALUES (artisan_a, artisan_b, 'Smoke Saree', 'I want to buy 5', 'new')
  RETURNING id INTO inq_id;

  UPDATE buyer_inquiries SET status = 'replied', status_updated_at = NOW() WHERE id = inq_id;

  -- 18. Invalid status must be rejected by the CHECK
  BEGIN
    UPDATE buyer_inquiries SET status = 'spam' WHERE id = inq_id;
    RAISE EXCEPTION 'FAIL: an invalid status must be rejected by the CHECK constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 19. Indexes for inquiry filtering exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'buyer_inquiries_artisan_status_idx') THEN
    RAISE EXCEPTION 'FAIL: buyer_inquiries_artisan_status_idx index is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'buyer_inquiries_buyer_artisan_idx') THEN
    RAISE EXCEPTION 'FAIL: buyer_inquiries_buyer_artisan_idx index is missing';
  END IF;

  -- 20. FK on buyer_artisan_id: deleting the buyer sets it to NULL
  DELETE FROM artisans WHERE id = artisan_b;
  SELECT buyer_artisan_id INTO v_result.artisan_id FROM buyer_inquiries WHERE id = inq_id;
  IF v_result.artisan_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: deleting the buyer artisan should SET NULL on buyer_artisan_id';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END
$$;

ROLLBACK;
