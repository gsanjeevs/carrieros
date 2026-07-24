// lib/domain/role-permissions.ts
// Rule A of docs/architecture-principles.md — a single shared source for
// "what can this role actually do," so the invite modals' permission
// preview and any future permissions-reference page can't drift the way
// team/InviteMemberButton.tsx's old one-line roleHelp_* text could (that
// text stays as a plain-language summary; this is the structured
// access-area breakdown the audit's "permission preview" gap asked for).
//
// Deliberately mirrors profiles.role's CHECK list (schema.sql) for the
// four roles this product actually invites through a UI today — solo has
// no invite flow (there's only ever one solo account) and the
// customer_*/sx_* roles are invited through their own separate flows
// (customer portal contacts, ShipmentX admin), not team/drivers.
export type InvitableRole = 'owner' | 'dispatcher' | 'finance' | 'driver'

export const INVITABLE_ROLES: readonly InvitableRole[] = ['owner', 'dispatcher', 'finance', 'driver']

// One row per access area shown in the permission preview. Keep this list
// short and coarse (screen/feature groupings, not per-table RLS detail) —
// it's a glanceable preview for the person sending the invite, not a
// substitute for reading the RLS policies in schema.sql.
export type PermissionArea =
  | 'loadsDispatch'
  | 'ratesInvoices'
  | 'customers'
  | 'teamBilling'
  | 'reports'
  | 'driverApp'

export const PERMISSION_AREAS: readonly PermissionArea[] = [
  'loadsDispatch',
  'ratesInvoices',
  'customers',
  'teamBilling',
  'reports',
  'driverApp',
]

export function roleHasPermission(role: InvitableRole, area: PermissionArea): boolean {
  switch (role) {
    case 'owner':
      return true
    case 'dispatcher':
      switch (area) {
        case 'loadsDispatch':
          return true
        case 'customers':
          return true
        case 'ratesInvoices':
          return false
        case 'teamBilling':
          return false
        case 'reports':
          return false
        case 'driverApp':
          return false
        default: {
          const _exhaustive: never = area
          return _exhaustive
        }
      }
    case 'finance':
      switch (area) {
        case 'ratesInvoices':
          return true
        case 'reports':
          return true
        case 'customers':
          return true
        case 'loadsDispatch':
          return false
        case 'teamBilling':
          return false
        case 'driverApp':
          return false
        default: {
          const _exhaustive: never = area
          return _exhaustive
        }
      }
    case 'driver':
      switch (area) {
        case 'driverApp':
          return true
        case 'loadsDispatch':
          return false
        case 'ratesInvoices':
          return false
        case 'customers':
          return false
        case 'teamBilling':
          return false
        case 'reports':
          return false
        default: {
          const _exhaustive: never = area
          return _exhaustive
        }
      }
    default: {
      const _exhaustive: never = role
      return _exhaustive
    }
  }
}
