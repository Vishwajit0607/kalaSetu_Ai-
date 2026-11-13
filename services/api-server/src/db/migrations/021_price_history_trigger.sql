-- Developer 2 / milestone 2: fill product_price_history automatically.
--
-- A TRIGGER on `products` writes a history row whenever a product is created, and
-- whenever either of its prices actually changes. It is done in the database, not in
-- the API, so EVERY way a price can change - the edit endpoint, a fix made by hand in
-- the SQL editor, a future feature - leaves a trace. Application code can forget; a
-- trigger cannot. An update that leaves both prices as they were (a stock sale, a
-- renamed title) writes nothing.
--
-- Existing products get one 'system' row for the price they have today, so their
-- history does not start empty. (Idempotent: only products with no history yet.)
--
-- Security: history is readable by the product's owner only (via the product's
-- artisan_id), and nobody but the database itself writes it - the write privileges are
-- revoked from the public roles. The trigger function runs as its owner
-- (SECURITY DEFINER, with a pinned search_path) so it can write the row whichever role
-- changed the product.

CREATE OR REPLACE FUNCTION log_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO product_price_history (product_id, retail_inr, wholesale_inr, source)
    VALUES (NEW.id, NEW.recommended_retail_inr, NEW.recommended_wholesale_inr, 'create');
  ELSIF NEW.recommended_retail_inr    IS DISTINCT FROM OLD.recommended_retail_inr
     OR NEW.recommended_wholesale_inr IS DISTINCT FROM OLD.recommended_wholesale_inr THEN
    INSERT INTO product_price_history (product_id, retail_inr, wholesale_inr, source)
    VALUES (NEW.id, NEW.recommended_retail_inr, NEW.recommended_wholesale_inr, 'edit');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_log_price ON products;
CREATE TRIGGER products_log_price
  AFTER INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION log_price_change();

-- "This product's prices, newest first" is the only question asked of the table.
CREATE INDEX IF NOT EXISTS product_price_history_product_time_idx
  ON product_price_history (product_id, changed_at DESC);

-- Products that existed before the trigger: record the price they have now.
INSERT INTO product_price_history (product_id, retail_inr, wholesale_inr, source, changed_at)
SELECT p.id, p.recommended_retail_inr, p.recommended_wholesale_inr, 'system', COALESCE(p.updated_at, NOW())
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM product_price_history h WHERE h.product_id = p.id);

ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_price_history_owner_read ON product_price_history;
CREATE POLICY product_price_history_owner_read ON product_price_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.artisan_id = auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON product_price_history FROM anon, authenticated;
