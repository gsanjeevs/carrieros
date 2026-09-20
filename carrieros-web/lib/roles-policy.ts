// lib/roles-policy.ts
// Rule B (docs/architecture-principles.md) — a shared source for role-gating
// arrays, starting with the one confirmed drift found in this session's
// architecture audit: `BILLING_ROLES` was defined as `['owner','solo','finance']`
// in five files (invoice viewing/creation/factoring) but `['owner','solo']`
// (no finance) in two others (add-payment-method, change-tier).
//
// Investigating both call sites shows these are likely two DIFFERENT
// policies that happened to share an identical name, not one policy that
// drifted — invoice actions are a normal finance-role responsibility, while
// changing the org's own subscription payment method or tier is treated as
// an ownership-level decision in the two billing routes. Rather than
// silently pick one and risk quietly changing access for real users, this
// splits them into two distinctly-named, still-explicit exports. If
// `INVOICE_ROLES` and `SUBSCRIPTION_ROLES` were actually meant to be
// identical, that's a one-line fix here — flag it for confirmation rather
// than assuming.
//
// Now derived from the generated `role_capabilities` table
// (lib/generated/role-capabilities.ts, backed by
// supabase/migrations/0009_role_capabilities.sql) instead of hand-maintained
// arrays, so this file and the migration can't drift the way BILLING_ROLES
// did. Kept as a thin re-export shim — rather than updating each call site
// to `roleHasCapability(...)` directly — because ~10 call sites across
// unrelated route/page files just do `INVOICE_ROLES.includes(role)` /
// `SUBSCRIPTION_ROLES.includes(role)`; re-deriving the same array here keeps
// those call sites untouched and confines the diff to this one file.
import { ROLE_CAPABILITIES, roleHasCapability } from '@/lib/generated/role-capabilities'

export const INVOICE_ROLES: string[] = Object.keys(ROLE_CAPABILITIES).filter((role) =>
  roleHasCapability(role, 'invoice_actions')
)
export const SUBSCRIPTION_ROLES: string[] = Object.keys(ROLE_CAPABILITIES).filter((role) =>
  roleHasCapability(role, 'subscription_management')
)
