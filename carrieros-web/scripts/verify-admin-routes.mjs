#!/usr/bin/env node
// scripts/verify-admin-routes.mjs
// One-off verification for the Phase 8 admin API foundation (2026-07-22).
// Generates a real session for a given user via a magic-link OTP exchange
// (no browser needed), then hits the /api/admin/** routes as that user.
//
// Usage: node scripts/verify-admin-routes.mjs <email> [baseUrl]

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = loadEnv(envPath)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

const email = process.argv[2]
const baseUrl = process.argv[3] || 'http://localhost:3000'
if (!email) {
  console.error('Usage: node scripts/verify-admin-routes.mjs <email> [baseUrl]')
  process.exit(1)
}

const admin = createClient(url, serviceKey)
const anon = createClient(url, anonKey)

async function main() {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr) throw linkErr

  const tokenHash = link.properties?.hashed_token
  if (!tokenHash) throw new Error('No hashed_token in generateLink response')

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  if (verifyErr) throw verifyErr

  const accessToken = verified.session?.access_token
  if (!accessToken) throw new Error('No access_token from verifyOtp')
  console.log(`Session established for ${email}`)

  const headers = { Authorization: `Bearer ${accessToken}` }

  const orgsRes = await fetch(`${baseUrl}/api/admin/orgs`, { headers })
  console.log(`GET /api/admin/orgs -> ${orgsRes.status}`)
  const orgsJson = await orgsRes.json()
  console.log(JSON.stringify(orgsJson, null, 2).slice(0, 2000))

  if (orgsRes.ok && orgsJson.orgs?.length) {
    const firstOrgId = orgsJson.orgs[0].org_id
    const detailRes = await fetch(`${baseUrl}/api/admin/orgs/${firstOrgId}`, { headers })
    console.log(`\nGET /api/admin/orgs/${firstOrgId} -> ${detailRes.status}`)
    const detailJson = await detailRes.json()
    console.log(JSON.stringify(detailJson, null, 2).slice(0, 2000))
  }
}

main().catch(err => {
  console.error('verify-admin-routes failed:', err)
  process.exit(1)
})
