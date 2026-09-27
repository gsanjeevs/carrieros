#!/usr/bin/env node
// carrieros-web/scripts/demo-samsara-setup.mjs
//
// One-time setup for the local Samsara demo: registers two of Sierra Freight
// Co's real demo vehicles (from load-demo-data.mjs) against the mock
// Samsara feed at app/api/dev/samsara-mock/fleet/vehicles/locations/feed,
// so app/api/cron/telematics/samsara-poll's REAL adapter code can be
// exercised end-to-end without a real Samsara account (none exists yet --
// see docs/decisions.md). This is not a bypass: the poller still makes a
// real HTTP call, parses a real (documented-shape) JSON response, and
// writes real vehicle_locations rows -- only the far end is a local double
// instead of api.samsara.com.
//
// Goes through the REAL app APIs (PATCH /api/v1/vehicles/{id}, PUT
// /api/v1/telematics-integrations), same "use the real HTTP path a user
// would" philosophy scripts/load-demo-data.mjs already follows, and
// necessary anyway: the integration's API key is encrypted server-side by
// that PUT route (lib/crypto/secrets.ts) -- this script has no business
// hand-rolling AES-GCM to write the encrypted column directly.
//
// Usage (after `npm run dev`, from carrieros-web):
//   APP_URL=http://localhost:3001 node scripts/demo-samsara-setup.mjs
// Then, in .env.local, set:
//   SAMSARA_API_BASE_URL=http://localhost:3001/api/dev/samsara-mock
// and restart the dev server (env vars are read at process start) so the
// poller actually calls the mock instead of the real Samsara API. Then run
// scripts/demo-samsara-drive.mjs to watch two trucks move on the live
// dispatch map (/dispatch) as they're repeatedly polled.
//
// Rerunnable: PATCHing the same telematics fields / PUTting the same
// integration twice is a no-op the second time, not an error.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadDotEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return {}
  const out = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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

const dotenv = loadDotEnvLocal()
const SUPABASE_URL = process.env.SUPABASE_URL || dotenv.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || dotenv.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || dotenv.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.APP_URL || 'http://localhost:3001'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or populate .env.local)')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const DEMO_EMAIL = 'demo@carrieros.dev'
const DEMO_PASSWORD = 'Demo123!'

async function signIn(email, password) {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return data.session.access_token
}

async function api(token, method, path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function main() {
  console.log(`Signing in as ${DEMO_EMAIL}...`)
  const token = await signIn(DEMO_EMAIL, DEMO_PASSWORD)

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('org_id')
    .eq('id', (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === DEMO_EMAIL)?.id)
    .maybeSingle()
  if (profileError || !profile) throw new Error(`Could not resolve ${DEMO_EMAIL}'s org: ${profileError?.message ?? 'no profile row'}`)

  const { data: vehicles, error: vehiclesError } = await admin
    .from('vehicles')
    .select('id, vehicle_number, nickname')
    .eq('carrier_org_id', profile.org_id)
    .order('id')
    .limit(2)
  if (vehiclesError) throw new Error(`Could not list Sierra Freight Co's vehicles: ${vehiclesError.message}`)
  if (vehicles.length < 2) {
    throw new Error('Sierra Freight Co needs at least 2 vehicles -- run scripts/load-demo-data.mjs first.')
  }

  const deviceIds = ['demo-samsara-truck-1', 'demo-samsara-truck-2']
  for (const [i, vehicle] of vehicles.entries()) {
    console.log(`Registering ${vehicle.nickname ?? vehicle.vehicle_number} (id ${vehicle.id}) as Samsara device ${deviceIds[i]}...`)
    await api(token, 'PATCH', `/api/v1/vehicles/${vehicle.id}`, {
      telematics_provider: 'samsara',
      telematics_device_id: deviceIds[i],
    })
  }

  console.log('Setting up the Samsara integration credential (any non-empty key -- the mock does not validate it)...')
  await api(token, 'PUT', '/api/v1/telematics-integrations', {
    provider: 'samsara',
    api_key: 'demo-mock-samsara-key',
    enabled: true,
  })

  console.log('\nDone. Two vehicles are now registered against the mock Samsara feed:')
  for (const [i, vehicle] of vehicles.entries()) {
    console.log(`  ${vehicle.nickname ?? vehicle.vehicle_number} (vehicles.id=${vehicle.id}) -> ${deviceIds[i]}`)
  }
  console.log('\nNext steps:')
  console.log('  1. In carrieros-web/.env.local, set:')
  console.log(`       SAMSARA_API_BASE_URL=${APP_URL}/api/dev/samsara-mock`)
  console.log('  2. Restart the dev server (env vars are read at process start).')
  console.log('  3. Run: node scripts/demo-samsara-drive.mjs')
  console.log('  4. Watch /dispatch -- two trucks driving Dallas <-> Houston, live.')
}

main().catch((e) => {
  console.error('DEMO SAMSARA SETUP FAILED:', e.message)
  process.exit(1)
})
