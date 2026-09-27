-- 0048_customer_portal_dashboard_capability.sql
--
-- Fixes a real, reproducible bug found during a UX/navigation review (2026-09-27): a customer_admin
-- or customer_viewer user cannot log in at all -- authenticating throws ERR_TOO_MANY_REDIRECTS.
--
-- Root cause: 0009_role_capabilities.sql deliberately seeded these two roles with zero rows ("today's
-- code has no defined behavior for them either... 'denied by default' is the honest current state"),
-- a known, intentionally-tracked gap at the time, not a regression. The consequence, only surfacing
-- now that the redirect chain was actually exercised through a real browser session (previous
-- coverage was API-only, via tests/audit/*): proxy.ts's ROLE_HOME has no entry for either role, so an
-- authenticated user is sent to the default '/dashboard'; '/dashboard' requires the `dashboard`
-- capability; neither role holds it, so the route guard bounces them back to
-- ROLE_HOME[role] ?? '/dashboard', which is '/dashboard' again -- infinite loop, no error page, no
-- way in.
--
-- Minimal, honest fix: grant `dashboard` only. app/(app)/dashboard/page.tsx already has a
-- `noViewForRole` fallback message written specifically for "a role with no defined dashboard view"
-- (its own comment names customer_admin/customer_viewer as the motivating case) -- that code was
-- already correct, it just never became reachable because the redirect loop happened one layer
-- earlier, in middleware, before the page ever got a chance to render. This does not attempt to build
-- the real customer-portal experience (a proper "my shipments" read-only view, scoped through the
-- already-correct `customer_loads_select` RLS policy on `loads` -- see that policy's own definition)
-- -- that is real, separate feature work with its own design questions, not a one-line capability
-- grant. This migration only turns "silently locked out with no way to even see an error" into "logs
-- in successfully and sees an honest, already-built 'no view for your role yet' message" -- a strict,
-- non-destructive improvement over today's actual behavior for these two roles, granting nothing
-- beyond what a role with genuinely no defined view has always been able to see (nothing).
INSERT INTO role_capabilities (role, capability) VALUES
  ('customer_admin',  'dashboard'),
  ('customer_viewer', 'dashboard');
