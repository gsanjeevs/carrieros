#!/usr/bin/env bash
#
# Still the right tool for just this: resetting the 2 carrier demo accounts'
# language/unit/date prefs and Sierra Freight Co's trial clock. It does NOT
# touch the extra ShipmentX-admin-console demo orgs (Trailhead Transport,
# Redline Logistics, Bluepeak Carriers, Cascade Freightways) -- those are
# seeded/reset by carrieros-web/scripts/load-demo-data.mjs (--reset), a
# distinct, broader scenario added 2026-09-24. Run that one too if those
# orgs' state has drifted.
#
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

-- Trial/subscription standing is now enforced by has_feature() (migration 0021): an expired trial locks gated
-- features. The demo org must never lapse, so every reset puts it back on a fresh 90-day trial.
UPDATE carrier_details SET billing_status = 'trialing', trial_ends_at = now() + interval '90 days', grace_period_until = NULL
WHERE org_id = (SELECT org_id FROM profiles WHERE id = (SELECT id FROM auth.users WHERE email = 'demo@carrieros.dev'));
"

echo "Reset preferred_language/uom_system/date_format/time_format for demo@carrieros.dev and mike.driver@carrieros.dev."
