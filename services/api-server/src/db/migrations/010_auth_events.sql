-- Developer 1 / milestone 1: an audit trail of account security events.
--
-- Until now nothing recorded who signed in, when, or that a password changed. An
-- artisan whose account is being guessed at, or who shares a phone, had no way to
-- see it. Each row is one event on one account.
--
--   event_type   signup | login | login_failed | logout | password_changed
--   ip           the caller's address as the server saw it (IPv6 fits in 45 chars)
--   user_agent   truncated, for "was that me?" recognition only
--
-- Rows are written by the API server and deleted with the account (ON DELETE
-- CASCADE), so deleting an account leaves no trace of it behind.

CREATE TABLE IF NOT EXISTS auth_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id  UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  event_type  VARCHAR(24) NOT NULL
              CHECK (event_type IN ('signup', 'login', 'login_failed', 'logout', 'password_changed')),
  ip          VARCHAR(45),
  user_agent  VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
