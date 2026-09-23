#!/usr/bin/env node
// carrieros-web/scripts/seed-staging-demo.mjs
// One-off seed for a fresh (migrated, empty) staging environment: creates
// demo@carrieros.dev (owner), mike.driver@carrieros.dev (driver), and
// info@shipmentx.com (sx_owner), matching the persistent local demo accounts
// documented in root CLAUDE.md. Users/org are created directly via the admin
// client (same technique as tests/helpers.ts's createTestUser/createTestOrg
// — proven correct, bypasses email delivery). Vehicles and loads go through
// the real deployed API instead of raw inserts, so numbering (T-1, L-1, ...)
// and validation match exactly what a real user gets — see
// app/api/vehicles/route.ts and app/api/loads/route.ts.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APP_URL=... node scripts/seed-staging-demo.mjs
// Idempotent-ish: re-running with the same emails will fail on the auth user
// creation step (email already registered) rather than silently duplicating.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.APP_URL
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !APP_URL) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const DEMO_PASSWORD = 'Demo123!'

async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function createOrg(type, name, extra = {}) {
  const org = await must(
    admin.from('organizations').insert({ type, name }).select('id').single(),
    `create org ${name}`
  )
  if (type === 'carrier') {
    await must(
      admin.from('carrier_details').insert({ org_id: org.id, tier: 'growth', ...extra }).select('org_id').single(),
      `carrier_details for ${name}`
    )
  }
  return org.id
}

async function createUser(email, orgId, role, firstName, lastName) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  await must(
    admin.from('profiles').insert({ id: created.user.id, org_id: orgId, role, first_name: firstName, last_name: lastName }),
    `profile for ${email}`
  )
  return created.user.id
}

async function signIn(email) {
  const anon = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
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
  console.log('Creating Sierra Freight Co (carrier, growth tier)...')
  const carrierOrgId = await createOrg('carrier', 'Sierra Freight Co')

  console.log('Creating demo@carrieros.dev (owner)...')
  // Name matches e2e/auth.spec.ts's hardcoded assertion, which mirrors the
  // name already established for this account in local dev.
  await createUser('demo@carrieros.dev', carrierOrgId, 'owner', 'Sam', 'Rivera')

  console.log('Creating mike.driver@carrieros.dev (driver)...')
  const driverUserId = await createUser('mike.driver@carrieros.dev', carrierOrgId, 'driver', 'Mike', 'Rodriguez')
  const driverRow = await must(
    admin.from('drivers').insert({ carrier_org_id: carrierOrgId, profile_id: driverUserId }).select('id').single(),
    'drivers row for mike.driver'
  )

  console.log('Creating ShipmentX platform org + info@shipmentx.com (sx_owner)...')
  const platformOrgId = await createOrg('platform', 'ShipmentX')
  await createUser('info@shipmentx.com', platformOrgId, 'sx_owner', 'ShipmentX', 'Admin')

  console.log('Signing in as demo@carrieros.dev to create fleet/loads via the real API...')
  const token = await signIn('demo@carrieros.dev')

  const { data: vehicleType } = await admin.from('vehicle_types').select('id').limit(1).single()
  console.log('Creating 2 vehicles...')
  await api(token, 'POST', '/api/vehicles', { nickname: 'Freightliner Cascadia', vehicle_type_id: vehicleType.id, year: 2022, make: 'Freightliner' })
  await api(token, 'POST', '/api/vehicles', { nickname: 'Peterbilt 579', vehicle_type_id: vehicleType.id, year: 2021, make: 'Peterbilt' })
  const vehicleRows = await must(
    admin.from('vehicles').select('id, vehicle_number').eq('carrier_org_id', carrierOrgId).order('id'),
    'list seeded vehicles'
  )

  console.log('Creating customer (Sierra Steel Fabricators)...')
  // First customer for a fresh org auto-numbers C-1, matching e2e/customer-contacts.spec.ts.
  await api(token, 'POST', '/api/customers', { name: 'Sierra Steel Fabricators', city: 'Dallas', state: 'TX' })

  console.log('Creating 3 loads...')
  const loadBase = {
    customer_name_raw: 'Acme Distribution', pickup_address: '100 Industrial Pkwy', pickup_city: 'Dallas', pickup_state: 'TX', pickup_zip: '75201',
    pickup_date: '2026-09-22', pickup_time: '08:00', delivery_address: '400 Commerce St', delivery_city: 'Houston', delivery_state: 'TX', delivery_zip: '77002',
    delivery_date: '2026-09-23', delivery_time: '14:00', commodity: 'General Freight', weight_lbs: 22000, rate: 1850, total_miles: 240, intake_method: 'manual',
  }
  for (let i = 0; i < 3; i++) {
    await api(token, 'POST', '/api/loads', loadBase)
  }
  const loadRows = await must(
    admin.from('loads').select('id, load_number').eq('carrier_org_id', carrierOrgId).order('id'),
    'list seeded loads'
  )

  console.log('Advancing L-1 to invoiced (so the invoices e2e test has something to find)...')
  await api(token, 'PATCH', `/api/loads/${loadRows[0].id}`, {
    driver_id: driverRow.id, vehicle_id: vehicleRows[0].id, status: 'invoiced',
  })

  console.log('Dispatching L-2 to the driver (so the driver e2e test has an active load)...')
  await api(token, 'PATCH', `/api/loads/${loadRows[1].id}`, {
    driver_id: driverRow.id, vehicle_id: vehicleRows[1].id, status: 'dispatched',
  })

  console.log('\nDone. Demo accounts (all password Demo123!):')
  console.log('  demo@carrieros.dev        owner, Sierra Freight Co')
  console.log('  mike.driver@carrieros.dev driver, same org')
  console.log('  info@shipmentx.com        sx_owner, ShipmentX platform org')
}

main().catch((e) => {
  console.error('SEED FAILED:', e.message)
  process.exit(1)
})
