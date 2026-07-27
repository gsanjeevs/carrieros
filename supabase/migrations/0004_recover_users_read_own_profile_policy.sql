-- 0004_recover_users_read_own_profile_policy.sql
-- Schema-drift repair found by the 2026-07-26 baseline audit.
--
-- `profiles.users_read_own_profile` existed in the live database but had never
-- been written back into supabase/schema/schema.sql. Under the old workflow
-- (apply ad hoc with psql, then hand-copy into schema.sql) that is an easy
-- omission to make and an impossible one to notice: the running system behaves
-- correctly, and the loss only materialises on the next `db reset` or fresh
-- environment — where it presents as an auth bug, far from its cause.
--
-- This is the single clearest argument for the migration system introduced in
-- 0000: drift between "what we ran" and "what we wrote down" is invisible until
-- it is expensive.
--
-- Functionally the policy is a subset of `same_org_profiles_select` (your own
-- row always shares your org), so recovering it changes no current behaviour.
-- It is worth keeping rather than discarding as redundant: the org-wide policy
-- resolves through my_org_id(), which is NULL for a user who has signed up but
-- not yet onboarded. Those users still need to read their own profile row, and
-- relying on a NULL-returning helper for that is fragile.
--
-- CREATE POLICY has no IF NOT EXISTS, and this migration must be applicable
-- both to a fresh database built from 0001 (where the policy is now present in
-- the baseline snapshot) and to an adopted one (where it already exists from
-- the ad-hoc era). Guarded on pg_policies for that reason.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'profiles'
       AND policyname = 'users_read_own_profile'
  ) THEN
    CREATE POLICY "users_read_own_profile" ON public.profiles
      FOR SELECT TO authenticated
      USING (auth.uid() = id);
  END IF;
END $$;
