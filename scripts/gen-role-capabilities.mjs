#!/usr/bin/env node
// scripts/gen-role-capabilities.mjs
//
// Reads the `role_capabilities` table (supabase/migrations/0009_role_capabilities.sql)
// and writes an IDENTICAL generated constants file into both apps. This is the
// same idea as scripts/regen-types.sh generating TS types from the schema:
// one source of truth in Postgres, mechanically reproduced into each app,
// instead of a human hand-writing matching arrays twice and trusting them to
// stay in sync (they already didn't once — see the migration's header comment).
//
// Run this after any migration that changes role_capabilities. Both generated
// files are byte-for-byte structurally identical (same roles, same
// capabilities) — only their file header/import style differs per app.
//
// Usage:
//   node scripts/gen-role-capabilities.mjs
//
// Connection: same convention as scripts/db/migrate.mjs — `docker exec
// <container> psql` by default, or set DATABASE_URL for a direct connection.

import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_carrieros'
const DIRECT_URL = process.env.DATABASE_URL || null
const DATABASE = process.env.PGDATABASE || 'postgres'

function psql(sql) {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q', '-t', '-A', '-c', sql]
  try {
    if (DIRECT_URL) {
      return execFileSync('psql', [DIRECT_URL, ...psqlArgs], { encoding: 'utf8' })
    }
    return execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, ...psqlArgs],
      { encoding: 'utf8' }
    )
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    throw new Error(detail || err.message)
  }
}

function fetchCapabilities() {
  const rows = psql(`select role, capability from role_capabilities order by role, capability`)
  const byRole = new Map()
  for (const line of rows.split('\n').filter(Boolean)) {
    const [role, capability] = line.split('|')
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(capability)
  }
  return byRole
}

function fetchCapabilityNames(byRole) {
  const set = new Set()
  for (const caps of byRole.values()) for (const c of caps) set.add(c)
  return [...set].sort()
}

const HEADER = `// GENERATED FILE — do not hand-edit.
// Source: role_capabilities table (supabase/migrations/0009_role_capabilities.sql).
// Regenerate with: node scripts/gen-role-capabilities.mjs
//
// This is the single source of truth for "which role can do what" —
// consumed identically by carrieros-web and carrieros-mobile so the two
// apps cannot drift the way hand-written role arrays already did once
// (BILLING_ROLES). This is UI/navigation gating only, NOT a security
// boundary — RLS on the actual data tables is what enforces access.
`

function renderModule(byRole, capabilityNames) {
  const roleEntries = [...byRole.entries()]
    .map(([role, caps]) => `  ${role}: [${caps.map((c) => `'${c}'`).join(', ')}],`)
    .join('\n')

  return `${HEADER}
export type RoleCapability = ${capabilityNames.map((c) => `'${c}'`).join(' | ')}

export const ROLE_CAPABILITIES: Record<string, RoleCapability[]> = {
${roleEntries}
}

export function roleHasCapability(role: string | null | undefined, capability: RoleCapability): boolean {
  if (!role) return false
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability)
}
`
}

const byRole = fetchCapabilities()
if (byRole.size === 0) {
  throw new Error('role_capabilities returned zero rows — is migration 0009 applied? Run node scripts/db/migrate.mjs first.')
}
const capabilityNames = fetchCapabilityNames(byRole)
const moduleSource = renderModule(byRole, capabilityNames)

const webPath = path.join(REPO_ROOT, 'carrieros-web/lib/generated/role-capabilities.ts')
const mobilePath = path.join(REPO_ROOT, 'carrieros-mobile/src/lib/generated/role-capabilities.ts')

writeFileSync(webPath, moduleSource)
writeFileSync(mobilePath, moduleSource)

console.log(`Wrote ${path.relative(REPO_ROOT, webPath)}`)
console.log(`Wrote ${path.relative(REPO_ROOT, mobilePath)}`)
console.log(`Roles: ${[...byRole.keys()].join(', ')}`)
console.log(`Capabilities: ${capabilityNames.join(', ')}`)
