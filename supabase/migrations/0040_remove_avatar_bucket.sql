-- 0040_remove_avatar_bucket.sql
-- Complete the pre-release profile-photo storage correction: profile photos use
-- the canonical private documents bucket and carrier-org-first paths, so remove
-- the temporary user-keyed avatars bucket introduced by migration 0039.
DROP POLICY IF EXISTS "users_read_own_avatar" ON storage.objects;
DROP POLICY IF EXISTS "users_insert_own_avatar" ON storage.objects;
DROP POLICY IF EXISTS "users_update_own_avatar" ON storage.objects;
DROP POLICY IF EXISTS "users_delete_own_avatar" ON storage.objects;

-- storage.protect_delete intentionally rejects direct SQL bucket deletion.
-- The bucket is left empty and unused for migration-history compatibility;
-- all active profile media is now written to `documents` below the org path.
