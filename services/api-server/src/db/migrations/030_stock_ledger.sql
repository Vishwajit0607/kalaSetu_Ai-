-- Nikhil Telkar / milestone 1: atomic stock ledger function and reason constraint.
--
-- Stock was previously updated with a read-then-write in Node, so two concurrent
-- adjustments could overwrite each other. The adjust_stock function locks the
-- product row (FOR UPDATE), ensures stock never falls below zero, updates
-- products.stock_quantity and records an immutable stock_movements audit row
-- in a single database transaction.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_reason_check'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_reason_check
      CHECK (reason IN ('voice', 'manual', 'order', 'sync'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id UUID,
  p_artisan_id UUID,
  p_delta INTEGER DEFAULT NULL,
  p_set_quantity INTEGER DEFAULT NULL,
  p_reason VARCHAR(32) DEFAULT 'manual',
  p_voice_transcript TEXT DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  artisan_id UUID,
  previous_quantity INTEGER,
  resulting_quantity INTEGER,
  delta INTEGER,
  movement_id UUID
) AS $$
DECLARE
  v_current_qty INTEGER;
  v_new_qty INTEGER;
  v_computed_delta INTEGER;
  v_movement_id UUID;
BEGIN
  -- 1. Validate inputs
  IF p_delta IS NULL AND p_set_quantity IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Either p_delta or p_set_quantity must be provided';
  END IF;

  IF p_reason NOT IN ('voice', 'manual', 'order', 'sync') THEN
    RAISE EXCEPTION 'INVALID_REASON: Reason must be voice, manual, order, or sync';
  END IF;

  -- 2. Lock product row to serialize concurrent writes
  SELECT p.stock_quantity
    INTO v_current_qty
    FROM products p
   WHERE p.id = p_product_id
     AND p.artisan_id = p_artisan_id
     AND p.deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product % does not exist or is not owned by artisan %', p_product_id, p_artisan_id;
  END IF;

  -- 3. Calculate new quantity and delta
  IF p_set_quantity IS NOT NULL THEN
    IF p_set_quantity < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock cannot be set to a negative value (%)', p_set_quantity;
    END IF;
    v_new_qty := p_set_quantity;
    v_computed_delta := v_new_qty - v_current_qty;
  ELSE
    v_computed_delta := p_delta;
    v_new_qty := v_current_qty + v_computed_delta;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Adjustment by % would reduce stock (%s) below zero', v_computed_delta, v_current_qty;
    END IF;
  END IF;

  -- 4. Update product stock and timestamp
  UPDATE products
     SET stock_quantity = v_new_qty,
         updated_at = NOW()
   WHERE id = p_product_id;

  -- 5. Record movement in stock ledger
  INSERT INTO stock_movements (
    product_id,
    artisan_id,
    delta,
    resulting_quantity,
    reason,
    voice_transcript
  ) VALUES (
    p_product_id,
    p_artisan_id,
    v_computed_delta,
    v_new_qty,
    p_reason,
    p_voice_transcript
  )
  RETURNING id INTO v_movement_id;

  -- 6. Return the updated state
  RETURN QUERY SELECT
    p_product_id,
    p_artisan_id,
    v_current_qty,
    v_new_qty,
    v_computed_delta,
    v_movement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION adjust_stock FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock TO service_role;
