// GENERATED FILE — do not hand-edit.
// Source: role_capabilities table (migrations 0009_role_capabilities.sql, 0023_action_capabilities.sql).
// Regenerate with: node scripts/gen-role-capabilities.mjs
//
// This is the single source of truth for "which role can do what" —
// consumed identically by carrieros-web and carrieros-mobile so the two
// apps cannot drift the way hand-written role arrays already did once
// (BILLING_ROLES).
//
// Since 0023 this gates ACTIONS (services and API routes), not just
// navigation: a wrong entry here is a real access bug. RLS on the data
// tables remains the enforcement backstop beneath it, and the black-box
// probes in tests/security-*.test.ts are what keep the two agreeing.

export type RoleCapability = 'admin' | 'admin_billing' | 'admin_flags' | 'admin_impersonate' | 'chat_participate' | 'customers_manage' | 'customers_view' | 'dashboard' | 'dispatch' | 'documents_delete' | 'documents_read' | 'documents_send' | 'documents_upload' | 'driver_profile_edit_own' | 'drivers' | 'drivers_manage' | 'dvir_attach_any' | 'dvir_file' | 'exceptions_view' | 'finance' | 'fuel_log' | 'ifta_record' | 'invoice_actions' | 'load_intake_extract' | 'loads_advance_status' | 'loads_manage' | 'loads_view' | 'location_share' | 'maintenance_view' | 'my_loads' | 'org_branding_manage' | 'org_documents_manage' | 'org_documents_view' | 'org_support_manage' | 'problem_report' | 'rate_visibility' | 'service_log' | 'settings_view' | 'settlements_manage' | 'settlements_view' | 'subscription_management' | 'team' | 'team_manage' | 'vehicles_manage'

export const ROLE_CAPABILITIES: Record<string, RoleCapability[]> = {
  dispatcher: ['chat_participate', 'customers_manage', 'customers_view', 'dashboard', 'dispatch', 'documents_read', 'documents_send', 'documents_upload', 'drivers', 'exceptions_view', 'fuel_log', 'ifta_record', 'load_intake_extract', 'loads_advance_status', 'loads_manage', 'loads_view', 'maintenance_view', 'settings_view'],
  driver: ['chat_participate', 'dashboard', 'documents_read', 'documents_upload', 'driver_profile_edit_own', 'dvir_file', 'fuel_log', 'ifta_record', 'loads_advance_status', 'location_share', 'my_loads', 'problem_report', 'settings_view', 'settlements_view'],
  finance: ['customers_view', 'dashboard', 'documents_read', 'finance', 'invoice_actions', 'loads_view', 'org_documents_view', 'rate_visibility', 'settings_view', 'settlements_manage', 'settlements_view'],
  owner: ['chat_participate', 'customers_manage', 'customers_view', 'dashboard', 'dispatch', 'documents_delete', 'documents_read', 'documents_send', 'documents_upload', 'drivers', 'drivers_manage', 'dvir_attach_any', 'dvir_file', 'exceptions_view', 'finance', 'fuel_log', 'ifta_record', 'invoice_actions', 'load_intake_extract', 'loads_advance_status', 'loads_manage', 'loads_view', 'location_share', 'maintenance_view', 'my_loads', 'org_branding_manage', 'org_documents_manage', 'org_documents_view', 'org_support_manage', 'problem_report', 'rate_visibility', 'service_log', 'settings_view', 'settlements_manage', 'settlements_view', 'subscription_management', 'team', 'team_manage', 'vehicles_manage'],
  solo: ['chat_participate', 'customers_manage', 'customers_view', 'dashboard', 'dispatch', 'documents_delete', 'documents_read', 'documents_send', 'documents_upload', 'driver_profile_edit_own', 'drivers', 'drivers_manage', 'dvir_attach_any', 'dvir_file', 'exceptions_view', 'finance', 'fuel_log', 'ifta_record', 'invoice_actions', 'load_intake_extract', 'loads_advance_status', 'loads_manage', 'loads_view', 'location_share', 'maintenance_view', 'my_loads', 'org_branding_manage', 'org_documents_manage', 'org_documents_view', 'org_support_manage', 'problem_report', 'rate_visibility', 'service_log', 'settings_view', 'settlements_manage', 'settlements_view', 'subscription_management', 'team', 'team_manage', 'vehicles_manage'],
  sx_finance: ['admin', 'admin_billing'],
  sx_owner: ['admin', 'admin_billing', 'admin_flags', 'admin_impersonate'],
  sx_support: ['admin', 'admin_impersonate'],
}

export function roleHasCapability(role: string | null | undefined, capability: RoleCapability): boolean {
  if (!role) return false
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability)
}

/**
 * Every role holding a capability, for the places that need the LIST rather than a yes/no:
 * a database filter (`.in('role', ...)`), or a UI that renders the roles which can do something.
 * Sorted so the output is stable to compare and diff.
 */
export function rolesWithCapability(capability: RoleCapability): string[] {
  return Object.keys(ROLE_CAPABILITIES)
    .filter((role) => ROLE_CAPABILITIES[role].includes(capability))
    .sort()
}
