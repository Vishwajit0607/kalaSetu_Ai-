-- Developer 1 / milestone 2: index and row-level security for auth_events.
--
-- Index: the activity screen asks "this artisan's events, newest first".
--
-- Row-level security: an artisan may READ their own events and nothing else. They
-- may not insert, change or delete any - an audit trail that its subject can edit
-- is not an audit trail. Only the API server (the service role, which bypasses
-- RLS) writes events. The write privileges are also revoked outright, so this
-- holds even if someone later adds a permissive policy by mistake.

CREATE INDEX IF NOT EXISTS auth_events_artisan_time_idx
  ON auth_events (artisan_id, created_at DESC);

ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_events_owner_read ON auth_events;
CREATE POLICY auth_events_owner_read ON auth_events
  FOR SELECT USING (auth.uid() = artisan_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON auth_events FROM anon, authenticated;
