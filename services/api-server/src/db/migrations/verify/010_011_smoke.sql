-- Smoke test for migrations 010-011 (the auth_events security trail).
--
-- HOW TO USE: after applying 010 and 011, paste this whole file into the Supabase
-- SQL Editor and run it. It succeeds if the last message is
--   "ALL CHECKS PASSED"
-- and fails loudly with "FAIL: <what>" otherwise.
--
-- SAFE: it creates its own throwaway artisans inside a transaction and ends with
-- ROLLBACK, so nothing it creates survives. (This file is NOT a migration: it lives
-- in verify/ and is never run by `npm run db:migrate`.)

BEGIN;

DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  n INTEGER;
BEGIN
  INSERT INTO artisans (id, phone_number, full_name, craft_category)
  VALUES (a, '+0' || substr(replace(a::text, '-', ''), 1, 10), 'Smoke A', 'pottery'),
         (b, '+0' || substr(replace(b::text, '-', ''), 1, 10), 'Smoke B', 'weaving');

  INSERT INTO auth_events (artisan_id, event_type) VALUES
    (a, 'login'), (a, 'logout'), (b, 'login');

  -- 010: the table's own rules ---------------------------------------------
  BEGIN
    INSERT INTO auth_events (artisan_id, event_type) VALUES (a, 'hacked');
    RAISE EXCEPTION 'FAIL: an unknown event_type must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO auth_events (artisan_id, event_type) VALUES (gen_random_uuid(), 'login');
    RAISE EXCEPTION 'FAIL: an event for a non-existent artisan must be rejected';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- 011: index and security ------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'auth_events_artisan_time_idx') THEN
    RAISE EXCEPTION 'FAIL: the (artisan, time) index is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'auth_events'::regclass) THEN
    RAISE EXCEPTION 'FAIL: row-level security is not enabled on auth_events';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'auth_events' AND policyname = 'auth_events_owner_read') THEN
    RAISE EXCEPTION 'FAIL: the owner-read policy is missing';
  END IF;

  IF has_table_privilege('authenticated', 'auth_events', 'INSERT')
     OR has_table_privilege('authenticated', 'auth_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'auth_events', 'DELETE')
     OR has_table_privilege('anon', 'auth_events', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users must not be able to write or erase the trail';
  END IF;

  -- Isolation, as the API would see it for a signed-in user: act as artisan a ...
  GRANT SELECT ON auth_events TO authenticated;   -- Supabase grants this by default; rolled back below
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM auth_events;
  RESET ROLE;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: artisan A should see exactly their 2 events, saw %', n; END IF;

  -- ... and as artisan b
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM auth_events;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: artisan B should see exactly their 1 event, saw %', n; END IF;

  -- Deleting an account deletes its trail.
  DELETE FROM artisans WHERE id = a;
  SELECT count(*) INTO n FROM auth_events WHERE artisan_id = a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: deleting the artisan must delete their events'; END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END
$$;

ROLLBACK;
