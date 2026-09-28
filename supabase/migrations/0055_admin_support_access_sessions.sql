-- 0055_admin_support_access_sessions.sql
-- Adds short-lived, actor-bound sessions for ShipmentX staff to inspect a carrier user's support
-- context without authenticating as that user or gaining write access to the carrier account.
-- Every start, view, and end is recorded in admin_events; direct client access stays denied.

CREATE TABLE admin_support_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES support_tickets(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_support_access_expiry_window CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '15 minutes'
  )
);

COMMENT ON TABLE admin_support_access_sessions IS
  'Actor-bound, read-only SX support inspection sessions; never authenticates as or mutates the target user.';

CREATE INDEX idx_admin_support_access_admin_active
  ON admin_support_access_sessions(admin_id, expires_at DESC)
  WHERE ended_at IS NULL;
CREATE INDEX idx_admin_support_access_org_started
  ON admin_support_access_sessions(org_id, started_at DESC);

ALTER TABLE admin_support_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_support_access_sessions FROM anon, authenticated;
GRANT SELECT, INSERT ON admin_support_access_sessions TO service_role;
GRANT UPDATE (ended_at, ended_by, last_accessed_at) ON admin_support_access_sessions TO service_role;
