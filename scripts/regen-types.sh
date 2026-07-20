#!/usr/bin/env bash
# Regenerates the Supabase-generated TypeScript types for both apps after any
# schema change (ALTER TABLE run directly against local Postgres — this repo
# has no supabase/migrations, schema changes are applied ad hoc and then
# docs/carrieros-db/schema.sql is updated by hand to match).
#
# Gotcha this script exists to avoid: `supabase gen types ... > file` looks
# safe, but the CLI writes a "Connecting to db ..." log line to stdout before
# the JSON/TS output on some invocations, and `2>&1 | tail` redirects that
# into the file too, corrupting it (silently — tsc then fails with a cryptic
# "Unexpected keyword or identifier" on line 1). Redirecting stderr to
# /dev/null keeps stdout clean.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Regenerating carrieros-web/types/supabase.ts ..."
supabase gen types typescript --local 2>/dev/null > carrieros-web/types/supabase.ts

echo "Regenerating carrieros-mobile/src/types/database.ts ..."
supabase gen types typescript --local 2>/dev/null > carrieros-mobile/src/types/database.ts

echo "Done. Verify with: (cd carrieros-web && npx tsc --noEmit) && (cd carrieros-mobile && npx tsc --noEmit)"
