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
export const INVOICE_ROLES: string[] = ['owner', 'solo', 'finance']
export const SUBSCRIPTION_ROLES: string[] = ['owner', 'solo']
