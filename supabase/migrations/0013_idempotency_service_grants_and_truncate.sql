-- 0013_idempotency_service_grants_and_truncate.sql
--
-- (1) Idempotency needs a reserve -> complete/abandon lifecycle to be safe under
-- concurrency: two simultaneous requests carrying the same key must not both run.
-- That means inserting the key FIRST (the UNIQUE constraint arbitrates), doing the
-- work, then updating the stored response -- or deleting the reservation if the work
-- failed so the client can retry. Client roles only hold SELECT/INSERT on the table
-- (0005) and must not gain more, so the API performs the lifecycle as service_role,
-- scoped by the verified actor's org and user in every statement.
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO service_role;
GRANT USAGE, SELECT ON SEQUENCE idempotency_keys_id_seq TO service_role;

-- (2) TRUNCATE is not subject to row-level security. 0003 revoked it from anon and
-- authenticated on every table that existed then, but default privileges hand it out
-- again to each table created afterwards -- so outbox_events, idempotency_keys,
-- audit_events (append-only by design) and change_events all carried it. PostgREST
-- exposes no TRUNCATE verb, so this was not reachable through the API, but there is no
-- reason for either role to hold it, and a privilege that is merely unreachable today
-- is one refactor away from reachable. Re-run the same sweep, and
-- verify-migrations.mjs now fails if any public table has it granted to a client role.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', t.relname);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t.relname);
  END LOOP;
END $$;
