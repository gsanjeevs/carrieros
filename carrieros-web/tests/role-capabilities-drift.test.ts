// tests/role-capabilities-drift.test.ts
// role_capabilities (migrations 0009 + 0023) is the single source of truth for role gating, but the apps read a
// GENERATED copy of it (lib/generated/role-capabilities.ts, written by scripts/gen-role-capabilities.mjs) so no
// request pays for a lookup. That copy is only trustworthy if it cannot silently fall behind the table — a
// migration that adds a row without a regenerate, or someone hand-editing the generated file, would otherwise
// grant or deny access that the database says nothing about. Same role `npm run check:api` plays for the API client.
//
// Capability NAMES are already guarded at compile time: RoleCapability is a union generated from the table, so a
// typo'd capability in a service or route fails `tsc`. What that cannot catch is the table and the copy disagreeing,
// which is what this file asserts, in both apps.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { adminClient } from './helpers'
import { ROLE_CAPABILITIES, roleHasCapability, rolesWithCapability } from '@/lib/generated/role-capabilities'

const admin = adminClient()
const REPO_ROOT = path.resolve(__dirname, '..', '..')

async function capabilitiesFromDatabase(): Promise<Record<string, string[]>> {
  const { data, error } = await admin.from('role_capabilities').select('role, capability')
  if (error) throw new Error(`role_capabilities: ${error.message}`)
  const byRole: Record<string, string[]> = {}
  for (const row of data ?? []) (byRole[row.role] ??= []).push(row.capability)
  for (const caps of Object.values(byRole)) caps.sort()
  return byRole
}

describe('the generated capability module matches the database', () => {
  it('has exactly the same roles and capabilities as role_capabilities', async () => {
    const fromDb = await capabilitiesFromDatabase()
    const generated = Object.fromEntries(
      Object.entries(ROLE_CAPABILITIES).map(([role, caps]) => [role, [...caps].sort()])
    )
    // One assertion over the whole map: a diff shows precisely which role drifted.
    expect(generated).toEqual(fromDb)
  })

  it('is byte-identical in both apps, so web and mobile cannot diverge', () => {
    const read = (p: string) =>
      readFileSync(path.join(REPO_ROOT, p), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('//')) // only the header differs per app
        .join('\n')
    expect(read('carrieros-mobile/src/lib/generated/role-capabilities.ts')).toBe(
      read('carrieros-web/lib/generated/role-capabilities.ts')
    )
  })
})

describe('the capability helpers', () => {
  it('deny an unknown or missing role rather than failing open', () => {
    expect(roleHasCapability(null, 'loads_manage')).toBe(false)
    expect(roleHasCapability(undefined, 'loads_manage')).toBe(false)
    expect(roleHasCapability('', 'loads_manage')).toBe(false)
    expect(roleHasCapability('not_a_role', 'loads_manage')).toBe(false)
    // customer portal roles hold no rows at all: denied by absence, which is the intended model.
    expect(roleHasCapability('customer_admin', 'loads_manage')).toBe(false)
  })

  it('agree with each other', () => {
    for (const capability of ['loads_manage', 'invoice_actions', 'dvir_file', 'admin_flags'] as const) {
      for (const role of Object.keys(ROLE_CAPABILITIES)) {
        expect(rolesWithCapability(capability).includes(role)).toBe(roleHasCapability(role, capability))
      }
    }
  })
})

// These pin the handful of rules where getting the role set wrong is an actual security bug, stated in plain
// terms so a future edit to the seed data has to confront them. They duplicate no logic — they assert outcomes.
describe('the rules that must not change by accident', () => {
  it('keeps drivers out of office work', () => {
    for (const capability of ['loads_manage', 'invoice_actions', 'settlements_manage', 'team_manage', 'customers_manage', 'documents_send', 'load_intake_extract'] as const) {
      expect(roleHasCapability('driver', capability), capability).toBe(false)
    }
  })

  it('keeps finance out of dispatch and the cab', () => {
    for (const capability of ['loads_manage', 'loads_advance_status', 'chat_participate', 'dvir_file', 'fuel_log', 'ifta_record', 'location_share'] as const) {
      expect(roleHasCapability('finance', capability), capability).toBe(false)
    }
  })

  it('keeps dispatchers out of money and org administration', () => {
    for (const capability of ['invoice_actions', 'settlements_manage', 'subscription_management', 'team_manage', 'drivers_manage', 'vehicles_manage'] as const) {
      expect(roleHasCapability('dispatcher', capability), capability).toBe(false)
    }
  })

  it('gives solo everything owner has, plus the driver-side actions it performs itself', () => {
    for (const capability of ROLE_CAPABILITIES.owner) expect(roleHasCapability('solo', capability), capability).toBe(true)
    expect(roleHasCapability('solo', 'driver_profile_edit_own')).toBe(true)
  })

  it('splits the ShipmentX console so support cannot reach billing or kill switches', () => {
    expect(rolesWithCapability('admin_billing')).toEqual(['sx_finance', 'sx_owner'])
    expect(rolesWithCapability('admin_flags')).toEqual(['sx_owner'])
    expect(rolesWithCapability('admin_impersonate')).toEqual(['sx_owner', 'sx_support'])
    // No carrier role may reach the admin console at all.
    for (const role of ['owner', 'solo', 'dispatcher', 'finance', 'driver']) {
      expect(roleHasCapability(role, 'admin'), role).toBe(false)
    }
  })
})
