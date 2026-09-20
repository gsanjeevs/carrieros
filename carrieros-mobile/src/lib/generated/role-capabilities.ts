// GENERATED FILE — do not hand-edit.
// Source: role_capabilities table (supabase/migrations/0009_role_capabilities.sql).
// Regenerate with: node scripts/gen-role-capabilities.mjs
//
// This is the single source of truth for "which role can do what" —
// consumed identically by carrieros-web and carrieros-mobile so the two
// apps cannot drift the way hand-written role arrays already did once
// (BILLING_ROLES). This is UI/navigation gating only, NOT a security
// boundary — RLS on the actual data tables is what enforces access.

export type RoleCapability = 'admin' | 'dashboard' | 'dispatch' | 'drivers' | 'finance' | 'invoice_actions' | 'my_loads' | 'subscription_management' | 'team'

export const ROLE_CAPABILITIES: Record<string, RoleCapability[]> = {
  dispatcher: ['dashboard', 'dispatch', 'drivers'],
  driver: ['dashboard', 'my_loads'],
  finance: ['dashboard', 'finance', 'invoice_actions'],
  owner: ['dashboard', 'dispatch', 'drivers', 'finance', 'invoice_actions', 'my_loads', 'subscription_management', 'team'],
  solo: ['dashboard', 'dispatch', 'drivers', 'finance', 'invoice_actions', 'my_loads', 'subscription_management', 'team'],
  sx_finance: ['admin'],
  sx_owner: ['admin'],
  sx_support: ['admin'],
}

export function roleHasCapability(role: string | null | undefined, capability: RoleCapability): boolean {
  if (!role) return false
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability)
}
