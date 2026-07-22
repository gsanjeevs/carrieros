#!/usr/bin/env node
// scripts/bootstrap-shipmentx.mjs
//
// One-off bootstrap for the ShipmentX platform-admin org + its first
// sx_owner account (Phase 8 foundation, 2026-07-22). Not a reusable
// invite flow — there's no admin account to invite the first one from yet.
// Once the admin console exists, further sx_* accounts should go through a
// real invite route mirroring app/api/team/invite/route.ts, not this script.
//
// Safe to re-run: it checks for an existing ShipmentX org / existing invite
// before creating either.
//
// Usage: node scripts/bootstrap-shipmentx.mjs [email]
//   (defaults to info@shipmentx.com if no email given)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = loadEnv(envPath)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in carrieros-web/.env.local')
  process.exit(1)
}

const email = (process.argv[2] || 'info@shipmentx.com').trim()
const admin = createClient(url, serviceKey)

async function main() {
  // 1. Find or create the ShipmentX org.
  let { data: org, error: findOrgErr } = await admin
    .from('organizations')
    .select('id, name, type')
    .eq('type', 'platform')
    .eq('name', 'ShipmentX')
    .maybeSingle()

  if (findOrgErr) throw findOrgErr

  if (!org) {
    const { data: newOrg, error: createOrgErr } = await admin
      .from('organizations')
      .insert({ type: 'platform', name: 'ShipmentX' })
      .select('id, name, type')
      .single()
    if (createOrgErr) throw createOrgErr
    org = newOrg
    console.log(`Created ShipmentX organization (org_id=${org.id})`)
  } else {
    console.log(`Found existing ShipmentX organization (org_id=${org.id})`)
  }

  // 2. Invite (or find) the auth user.
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { org_id: org.id, role: 'sx_owner' },
  })

  let userId
  if (inviteErr) {
    const msg = inviteErr.message ?? ''
    if (inviteErr.status === 422 || /already/i.test(msg)) {
      // Already invited/registered — look up the existing auth user by email.
      const { data: list, error: listErr } = await admin.auth.admin.listUsers()
      if (listErr) throw listErr
      const existing = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (!existing) throw new Error(`Invite says "${msg}" but no matching auth user found for ${email}`)
      userId = existing.id
      console.log(`Auth user already exists for ${email} (id=${userId})`)
    } else {
      throw inviteErr
    }
  } else {
    userId = inviteData.user.id
    console.log(`Invited ${email} (id=${userId}) — magic link email sent`)
  }

  // 3. Find or create the profiles row.
  const { data: existingProfile, error: profileLookupErr } = await admin
    .from('profiles')
    .select('id, role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileLookupErr) throw profileLookupErr

  if (existingProfile) {
    console.log(`Profile already exists for ${email}: role=${existingProfile.role}, org_id=${existingProfile.org_id}`)
    if (existingProfile.role !== 'sx_owner' || existingProfile.org_id !== org.id) {
      console.warn(
        `WARNING: existing profile does not match expected sx_owner/ShipmentX org_id=${org.id} — not overwriting automatically.`
      )
    }
  } else {
    const { error: insertProfileErr } = await admin.from('profiles').insert({
      id: userId,
      org_id: org.id,
      role: 'sx_owner',
      first_name: 'ShipmentX',
      last_name: 'Admin',
    })
    if (insertProfileErr) throw insertProfileErr
    console.log(`Created profiles row for ${email}: role=sx_owner, org_id=${org.id}`)
  }

  console.log('\nDone. Log in via the normal magic-link flow at /login with', email)
}

main().catch(err => {
  console.error('bootstrap-shipmentx failed:', err)
  process.exit(1)
})
