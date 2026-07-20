#!/usr/bin/env bash
# Resets the persistent demo accounts' mutable preferences back to known
# defaults after manual/browser-automation testing changes them (language,
# units, date/time format). These accounts are NOT deleted between sessions
# on purpose (see docs/resume.md) — org/truck/driver/load rows are stable
# fixtures and don't need resetting; only per-user prefs drift during testing.
#
#   demo@carrieros.dev        (owner, Sierra Freight Co)
#   mike.driver@carrieros.dev (driver, Sierra Freight Co)
set -euo pipefail

docker exec supabase_db_carrieros psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
UPDATE profiles SET preferred_language = 'en', uom_system = NULL, date_format = 'MM/DD/YYYY', time_format = '12h'
WHERE id IN (SELECT id FROM auth.users WHERE email IN ('demo@carrieros.dev', 'mike.driver@carrieros.dev'));
"

echo "Reset preferred_language/uom_system/date_format/time_format for demo@carrieros.dev and mike.driver@carrieros.dev."
