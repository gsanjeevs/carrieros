#!/usr/bin/env node
// carrieros-web/scripts/load-demo-data.mjs
//
// Rerunnable demo-data loader for local/staging environments. Supersedes
// seed-staging-demo.mjs (which errors on a second run because
// admin.auth.admin.createUser rejects an already-registered email) and
// scripts/reset-demo.sh at the repo root (folded in as --reset below).
// Both older scripts are left in place but now say so in their own header
// comments — see that follow-up commit note in CLAUDE.md.
//
// What this does, every run:
//   1. Ensures the 3 persistent demo accounts from CLAUDE.md exist, unchanged
//      (demo@carrieros.dev owner / mike.driver@carrieros.dev driver, both on
//      "Sierra Freight Co"; info@shipmentx.com sx_owner on "ShipmentX").
//   2. Ensures 4 additional carrier orgs exist, each in a different state, so
//      the /admin triage queue, /admin/health, /admin/pipeline and
//      /admin/billing screens have enough varied data to be demonstrable
//      instead of empty or single-row:
//        - "Trailhead Transport"  — trialing, trial_ends_at ~4 days out
//                                   (pipeline "trials ending soon" + triage
//                                   high-urgency bucket)
//        - "Redline Logistics"    — past_due, in a grace period
//                                   (triage "critical" + billing "at risk")
//        - "Bluepeak Carriers"    — starter tier, high load volume + 2 active
//                                   drivers (pipeline "upgrade candidates")
//        - "Cascade Freightways"  — growth tier, healthy, unremarkable
//   3. Gives each org a driver, a vehicle, a customer, and a handful of
//      loads across draft/dispatched/delivered/invoiced so load-velocity and
//      health scoring have real signal.
//   4. Adds one open support ticket (Redline Logistics — the past_due org,
//      so triage's "open ticket" floor and the ticket-reply UI have
//      something real to act on).
//   5. Adds invoices in all 4 states (draft/sent/paid/overdue) on Bluepeak
//      Carriers.
//   6. Adds one webhook + one delivery record on the primary demo org
//      (Sierra Freight Co), for /settings/integrations.
//   7. Adds one plain-English driver-chat message on one of Sierra Freight
//      Co's dispatched loads.
//
// Idempotency: every fixed entity (org by name, user by email) is looked up
// before insert and reused if present. Bulk per-org fixtures (vehicles,
// drivers, customers, loads, invoices, the support ticket, the webhook, the
// driver message) are only created the FIRST time an org is seeded — the
// presence check is "does this org already have any rows in that table",
// so re-running the script is a fast no-op for orgs that already have data
// rather than a duplicate-generator. This is a deliberate, simpler contract
// than field-level upserts: re-running never duplicates, but it also won't
// "top up" an org you've since edited by hand in the demo.
//
// Writes go straight through the service-role admin client to the tables
// (not the app's /api/v1 layer) for orgs/users/vehicles/drivers/customers/
// loads/invoices/support tickets/webhooks — this script needs to write data
// belonging to OTHER organizations than whichever one it happens to sign in
// as, which the real session-scoped APIs correctly refuse to do. It reuses
// the same numbering RPC the app itself calls (`next_entity_val`) so
// load/vehicle/driver/customer numbers look exactly like normal app output.
//
// Usage:
//   node scripts/load-demo-data.mjs           # seed (idempotent)
//   node scripts/load-demo-data.mjs --reset   # wipe the 4 extra orgs + the
//                                              # extra webhook/ticket, then
//                                              # reseed; leaves the 3
//                                              # persistent accounts' core
//                                              # identity untouched (same
//                                              # "reset drift, don't delete"
//                                              # philosophy as reset-demo.sh)
//
// Env (same as seed-staging-demo.mjs): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Falls back to reading carrieros-web/.env.local (NEXT_PUBLIC_SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY) if the SUPABASE_URL env vars aren't set, same as
// bootstrap-shipmentx.mjs.
import { createClient } from '@supabase/supabase-js'
import { deflateSync } from 'node:zlib'
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
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || dotenv.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or run from carrieros-web with a populated .env.local)')
  process.exit(1)
}

const RESET = process.argv.includes('--reset')
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const DEMO_PASSWORD = 'Demo123!'

async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

// Small deterministic PNGs keep demo media synthetic, local, and rerunnable;
// no real-person or scraped images are checked into the repository.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4)
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type)
    const body = Buffer.concat([t, data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function avatarPng(seed) {
  const bg = seed % 2 ? [219, 234, 254] : [254, 226, 226]
  return png(128, 128, (x, y) => {
    const dx = x - 64, dy = y - 64
    const face = dx * dx + dy * dy < 30 * 30
    const hair = dy < -10 && dx * dx + (dy + 8) * (dy + 8) < 34 * 34
    const shirt = dy > 28 && Math.abs(dx) < 48
    return face ? [244, 190, 150, 255] : hair ? [55, 45, 42, 255] : shirt ? [30, 91, 140, 255] : [...bg, 255]
  })
}
function vehiclePng(seed) {
  const accent = seed % 2 ? [234, 88, 57] : [36, 116, 170]
  return png(320, 140, (x, y) => {
    const cab = x > 28 && x < 110 && y > 50 && y < 108
    const trailer = x >= 110 && x < 285 && y > 30 && y < 108
    const window = cab && x > 48 && x < 92 && y > 60 && y < 78
    const wheel = ((x - 80) ** 2 + (y - 111) ** 2 < 16 ** 2) || ((x - 235) ** 2 + (y - 111) ** 2 < 16 ** 2)
    return wheel ? [35, 35, 40, 255] : window ? [180, 220, 235, 255] : (cab || trailer) ? [...accent, 255] : [235, 242, 248, 255]
  })
}

async function ensureDemoCompliance(orgId, driverId, profileId, vehicles) {
  const { data: profile } = await admin.from('profiles').select('avatar_path').eq('id', profileId).single()
  // Migrate the pre-release temporary avatars bucket fixture once; preserve
  // any real/user-edited avatar path after it has moved to documents.
  if (profile && (!profile.avatar_path || /\/demo-profile\.png$/.test(profile.avatar_path))) {
    const demoUuid = `00000000-0000-0000-0000-${String(driverId).padStart(12, '0')}`
    const path = `${orgId}/profiles/${profileId}/avatar-${demoUuid}.png`
    const uploaded = await admin.storage.from('documents').upload(path, avatarPng(driverId), { contentType: 'image/png', upsert: true })
    if (!uploaded.error) await must(admin.from('profiles').update({ avatar_path: path }).eq('id', profileId), 'demo avatar path')
  }

  const { data: driver } = await admin.from('drivers').select('cdl_number, cdl_class, cdl_state, cdl_expiry, med_cert_expiry, endorsements').eq('id', driverId).single()
  if (driver) {
    const patch = {}
    if (!driver.cdl_number) patch.cdl_number = `DEMO-${String(driverId).padStart(5, '0')}`
    if (!driver.cdl_class) patch.cdl_class = 'A'
    if (!driver.cdl_state) patch.cdl_state = 'TX'
    if (!driver.cdl_expiry) patch.cdl_expiry = '2028-06-30'
    if (!driver.med_cert_expiry) patch.med_cert_expiry = '2027-12-31'
    if (!driver.endorsements?.length) patch.endorsements = ['T', 'N']
    if (Object.keys(patch).length) await must(admin.from('drivers').update(patch).eq('id', driverId), 'demo driver compliance fields')
  }

  const { count: docCount } = await admin.from('driver_documents').select('id', { count: 'exact', head: true }).eq('driver_id', driverId)
  if (!docCount) {
    for (const [docType, expiry, suffix] of [['cdl_scan', '2028-06-30', 'cdl'], ['medical_cert', '2027-12-31', 'medical']]) {
      const path = `${orgId}/drivers/${driverId}/demo-${suffix}.png`
      const uploaded = await admin.storage.from('documents').upload(path, avatarPng(driverId + suffix.length), { contentType: 'image/png', upsert: true })
      if (!uploaded.error) await must(admin.from('driver_documents').insert({ driver_id: driverId, carrier_org_id: orgId, doc_type: docType, label: `DEMO ${docType.replace('_', ' ')}`, storage_path: path, expiry_date: expiry, uploaded_by: profileId }), `demo ${docType}`)
    }
  }

  for (const vehicle of vehicles) {
    const { data: current } = await admin.from('vehicles').select('photo_path, license_plate, license_state').eq('id', vehicle.id).single()
    const vehiclePatch = {}
    if (!current?.license_plate) vehiclePatch.license_plate = `DEMO${String(vehicle.id).padStart(4, '0')}`
    if (!current?.license_state) vehiclePatch.license_state = 'TX'
    if (Object.keys(vehiclePatch).length) await must(admin.from('vehicles').update(vehiclePatch).eq('id', vehicle.id), 'demo vehicle license fields')
    if (!current?.photo_path) {
      const path = `${orgId}/vehicles/${vehicle.id}/demo-vehicle.png`
      const uploaded = await admin.storage.from('documents').upload(path, vehiclePng(vehicle.id), { contentType: 'image/png', upsert: true })
      if (!uploaded.error) await must(admin.from('vehicles').update({ photo_path: path }).eq('id', vehicle.id), 'demo vehicle photo path')
    }
  }
}

async function nextNumber(orgId, entity, prefix) {
  const n = await must(admin.rpc('next_entity_val', { carrier_org_bigint: orgId, entity_name: entity }), `next_entity_val(${orgId}, ${entity})`)
  return `${prefix}-${n}`
}

// ---- orgs / users -----------------------------------------------------

async function findOrgByName(type, name) {
  return must(
    admin.from('organizations').select('id').eq('type', type).eq('name', name).maybeSingle(),
    `find org ${name}`
  )
}

async function ensureCarrierOrg(name, carrierDetails) {
  const existing = await findOrgByName('carrier', name)
  if (existing) {
    // Keep mutable billing/tier fields in sync on every run (these ARE meant
    // to reflect the demo scenario, not drift), but never touch identity.
    await must(
      admin.from('carrier_details').update(carrierDetails).eq('org_id', existing.id).select('org_id').single(),
      `update carrier_details for ${name}`
    )
    return { id: existing.id, created: false }
  }
  const org = await must(
    admin.from('organizations').insert({ type: 'carrier', name }).select('id').single(),
    `create org ${name}`
  )
  await must(
    admin.from('carrier_details').insert({ org_id: org.id, ...carrierDetails }).select('org_id').single(),
    `carrier_details for ${name}`
  )
  return { id: org.id, created: true }
}

async function findAuthUserByEmail(email) {
  // No admin.auth.admin.getUserByEmail in this SDK version — list + filter,
  // same approach bootstrap-shipmentx.mjs already uses for its "already
  // invited" fallback path.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function ensureUser(email, orgId, role, firstName, lastName) {
  let authUser = await findAuthUserByEmail(email)
  if (!authUser) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    })
    if (error) throw new Error(`createUser ${email}: ${error.message}`)
    authUser = created.user
    console.log(`  created auth user ${email}`)
  }

  const { data: profile } = await admin.from('profiles').select('id, org_id, role').eq('id', authUser.id).maybeSingle()
  if (!profile) {
    await must(
      admin.from('profiles').insert({ id: authUser.id, org_id: orgId, role, first_name: firstName, last_name: lastName }),
      `profile for ${email}`
    )
    console.log(`  created profile for ${email} (${role})`)
  }
  return authUser.id
}

async function ensureDriver(orgId, profileId) {
  const { data: existing } = await admin.from('drivers').select('id').eq('carrier_org_id', orgId).eq('profile_id', profileId).maybeSingle()
  if (existing) return existing.id
  const driverNumber = await nextNumber(orgId, 'driver', 'D')
  const row = await must(
    admin.from('drivers').insert({ carrier_org_id: orgId, profile_id: profileId, driver_number: driverNumber, invite_status: 'accepted', is_active: true }).select('id').single(),
    `drivers row for profile ${profileId}`
  )
  return row.id
}

async function orgHasAnyRows(table, orgColumn, orgId) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(orgColumn, orgId)
  if (error) throw new Error(`count ${table} for org ${orgId}: ${error.message}`)
  return (count ?? 0) > 0
}

async function ensureVehicles(orgId, specs) {
  if (await orgHasAnyRows('vehicles', 'carrier_org_id', orgId)) return await must(admin.from('vehicles').select('id').eq('carrier_org_id', orgId).order('id'), 'list vehicles')
  const vehicleType = await must(admin.from('vehicle_types').select('id').limit(1).single(), 'vehicle_types')
  const rows = []
  for (const spec of specs) {
    const vehicleNumber = await nextNumber(orgId, 'vehicle', 'T')
    const row = await must(
      admin.from('vehicles').insert({ carrier_org_id: orgId, vehicle_number: vehicleNumber, vehicle_type_id: vehicleType.id, ...spec }).select('id').single(),
      `vehicle ${spec.nickname}`
    )
    rows.push(row)
  }
  return rows
}

async function ensureCustomer(orgId, spec) {
  const { data: existing } = await admin
    .from('customer_details')
    .select('org_id, organizations!customer_details_org_id_fkey(name)')
    .eq('carrier_org_id', orgId)
  if (existing && existing.length > 0) return existing[0].org_id
  const customerOrg = await must(
    admin.from('organizations').insert({ type: 'customer', name: spec.name, city: spec.city, state: spec.state }).select('id').single(),
    `customer org ${spec.name}`
  )
  const customerNumber = await nextNumber(orgId, 'customer', 'C')
  await must(
    admin.from('customer_details').insert({ org_id: customerOrg.id, carrier_org_id: orgId, customer_number: customerNumber }).select('org_id').single(),
    `customer_details for ${spec.name}`
  )
  return customerOrg.id
}

async function ensureLoads(orgId, customerOrgId, driverId, vehicleId, loadSpecs) {
  if (await orgHasAnyRows('loads', 'carrier_org_id', orgId)) return await must(admin.from('loads').select('id, status').eq('carrier_org_id', orgId).order('id'), 'list loads')
  const rows = []
  for (const spec of loadSpecs) {
    const loadNumber = await nextNumber(orgId, 'load', 'L')
    const row = await must(
      admin
        .from('loads')
        .insert({
          carrier_org_id: orgId,
          customer_org_id: customerOrgId,
          customer_name_raw: 'Acme Distribution',
          load_number: loadNumber,
          driver_id: spec.status === 'draft' ? null : driverId,
          vehicle_id: spec.status === 'draft' ? null : vehicleId,
          pickup_address: '100 Industrial Pkwy', pickup_city: 'Dallas', pickup_state: 'TX', pickup_zip: '75201',
          pickup_date: spec.pickupDate, pickup_time: '08:00',
          delivery_address: '400 Commerce St', delivery_city: 'Houston', delivery_state: 'TX', delivery_zip: '77002',
          delivery_date: spec.deliveryDate, delivery_time: '14:00',
          commodity: 'General Freight', weight_lbs: 22000, rate: spec.rate ?? 1850, total_miles: 240,
          intake_method: 'manual', status: spec.status,
          created_at: spec.createdAt,
        })
        .select('id, status')
        .single(),
      `load ${loadNumber} (${spec.status})`
    )
    rows.push(row)
  }
  return rows
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}
function daysFromNow(n) {
  return new Date(Date.now() + n * 86_400_000).toISOString()
}
function dateOnly(isoOrDaysOffset) {
  return isoOrDaysOffset.slice(0, 10)
}

// ---- billing/support/webhooks/chat extras -----------------------------

async function ensureInvoices(orgId, loadRows) {
  if (await orgHasAnyRows('invoices', 'carrier_org_id', orgId)) return
  const states = [
    { status: 'draft', amount: 1850, due_date: null, sent_at: null, paid_at: null },
    { status: 'sent', amount: 2200, due_date: dateOnly(daysFromNow(15)), sent_at: daysAgo(5), paid_at: null },
    { status: 'paid', amount: 1975, due_date: dateOnly(daysAgo(10)), sent_at: daysAgo(20), paid_at: daysAgo(12) },
    { status: 'overdue', amount: 3100, due_date: dateOnly(daysAgo(15)), sent_at: daysAgo(30), paid_at: null },
  ]
  for (let i = 0; i < states.length; i++) {
    const invoiceNumber = await nextNumber(orgId, 'invoice', 'INV')
    const loadId = loadRows[i % loadRows.length]?.id ?? null
    await must(
      admin.from('invoices').insert({
        carrier_org_id: orgId,
        load_id: loadId,
        invoice_number: invoiceNumber,
        ...states[i],
      }).select('id').single(),
      `invoice ${invoiceNumber}`
    )
  }
  console.log('  seeded 4 invoices (draft/sent/paid/overdue)')
}

async function ensureSupportTicket(orgId, submittedByProfileId) {
  const { count } = await admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('carrier_org_id', orgId)
  if ((count ?? 0) > 0) return
  await must(
    admin.from('support_tickets').insert({
      submitted_by: submittedByProfileId,
      carrier_org_id: orgId,
      submitter_role: 'owner',
      submitter_tier: 'growth',
      category: 'account_billing',
      body: 'Our card on file was declined and now the account shows past due — can someone confirm the grace period end date and help us update payment info?',
      queue: 'carrieros_support',
      status: 'open',
    }).select('id').single(),
    'support ticket'
  )
  console.log('  seeded 1 open support ticket')
}

async function ensureWebhook(orgId, createdByProfileId) {
  if (await orgHasAnyRows('webhooks', 'org_id', orgId)) return
  const secret = `whsec_${[...Array(48)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`
  const webhook = await must(
    admin.from('webhooks').insert({
      org_id: orgId,
      url: 'https://example-tms-integration.test/webhooks/carrieros',
      secret,
      subscribed_events: ['load.status_changed', 'invoice.paid'],
      enabled: true,
      created_by: createdByProfileId,
    }).select('id').single(),
    'webhook'
  )
  await must(
    admin.from('webhook_deliveries').insert({
      webhook_id: webhook.id,
      org_id: orgId,
      event_type: 'load.status_changed',
      payload: { load_number: 'L-1', status: 'delivered' },
      status: 'success',
      attempt_count: 1,
      last_attempted_at: daysAgo(1),
      last_response_status: 200,
    }).select('id').single(),
    'webhook delivery'
  )
  console.log('  seeded 1 webhook + 1 delivery')
}

async function ensureDriverMessage(orgId, loadId, senderProfileId) {
  const { count } = await admin.from('driver_messages').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
  if ((count ?? 0) > 0) return
  await must(
    admin.from('driver_messages').insert({
      carrier_org_id: orgId,
      load_id: loadId,
      sender_id: senderProfileId,
      body: 'Picked up the load, running about 30 minutes behind schedule due to traffic on I-45. Will update at the next stop.',
      original_language: 'en',
    }).select('id').single(),
    'driver message'
  )
  console.log('  seeded 1 driver-chat message')
}

// ---- reset --------------------------------------------------------------

const EXTRA_ORG_NAMES = ['Trailhead Transport', 'Redline Logistics', 'Bluepeak Carriers', 'Cascade Freightways']

async function deleteWhere(table, column, value) {
  const { error } = await admin.from(table).delete().eq(column, value)
  if (error) throw new Error(`delete ${table} where ${column}=${value}: ${error.message}`)
}

async function resetExtraOrgs() {
  console.log('--reset: deleting the 4 extra demo orgs (and their loads/vehicles/drivers/customers/invoices/tickets/webhooks via ON DELETE CASCADE)...')
  for (const name of EXTRA_ORG_NAMES) {
    const org = await findOrgByName('carrier', name)
    if (!org) continue
    // Drivers/loads/vehicles/invoices/support_tickets/webhooks all cascade off
    // organizations(id) on delete (see schema.sql) -- deleting the org is
    // enough. Auth users + profiles for that org's staff are cleaned up too,
    // since they're throwaway fixtures created only for this scenario (unlike
    // the 3 persistent accounts, which this function never touches).
    // Several FKs to organizations(id) (and each other) in this schema are
    // NOT ON DELETE CASCADE: support_tickets.carrier_org_id,
    // loads.customer_org_id, invoices.load_id, customer_details.carrier_org_id,
    // drivers.profile_id, profiles.org_id. A `.delete()` blocked by one of
    // these fails its ENTIRE statement (no rows removed) -- checking the
    // error on every step (not just the final org delete) matters here, or a
    // silently-failed early step leaves rows that break a later step in a
    // confusing way. Order: invoices (frees loads) -> support_tickets ->
    // loads (cascades driver_messages) -> drivers (frees profiles) ->
    // customer orgs -> staff auth users (cascades profiles) -> the org itself
    // (cascades carrier_details/vehicles/webhooks).
    await deleteWhere('invoices', 'carrier_org_id', org.id)
    await deleteWhere('support_tickets', 'carrier_org_id', org.id)
    await deleteWhere('loads', 'carrier_org_id', org.id)
    await deleteWhere('drivers', 'carrier_org_id', org.id)
    const { data: customerLinks } = await admin.from('customer_details').select('org_id').eq('carrier_org_id', org.id)
    for (const c of customerLinks ?? []) {
      await must(admin.from('organizations').delete().eq('id', c.org_id).select('id').single(), `delete customer org ${c.org_id} for ${name}`)
    }
    const { data: profiles } = await admin.from('profiles').select('id').eq('org_id', org.id)
    for (const p of profiles ?? []) {
      const { error: delErr } = await admin.auth.admin.deleteUser(p.id) // cascades the profiles row
      if (delErr) throw new Error(`deleteUser ${p.id}: ${delErr.message}`)
    }
    await must(admin.from('organizations').delete().eq('id', org.id).select('id').single(), `delete org ${name}`)
    console.log(`  deleted ${name} (org_id=${org.id}) + ${profiles?.length ?? 0} staff account(s)`)
  }
  // The Sierra Freight Co webhook/support-ticket/invoice extras seeded onto
  // the persistent org are also scenario data, not identity -- clear them so
  // --reset gives a clean slate for those tables too, then let the normal
  // seed pass below recreate them.
  const sierra = await findOrgByName('carrier', 'Sierra Freight Co')
  if (sierra) {
    await admin.from('webhooks').delete().eq('org_id', sierra.id)
    console.log('  cleared Sierra Freight Co webhooks (will reseed)')
  }
}

// ---- main ---------------------------------------------------------------

async function seedPersistentAccounts() {
  console.log('Ensuring persistent demo accounts (Sierra Freight Co / ShipmentX)...')
  const sierra = await ensureCarrierOrg('Sierra Freight Co', { tier: 'growth' })
  const ownerId = await ensureUser('demo@carrieros.dev', sierra.id, 'owner', 'Sam', 'Rivera')
  const driverProfileId = await ensureUser('mike.driver@carrieros.dev', sierra.id, 'driver', 'Mike', 'Rodriguez')
  const driverId = await ensureDriver(sierra.id, driverProfileId)

  const platform = await findOrgByName('platform', 'ShipmentX')
  const platformOrgId = platform
    ? platform.id
    : (await must(admin.from('organizations').insert({ type: 'platform', name: 'ShipmentX' }).select('id').single(), 'create ShipmentX org')).id
  await ensureUser('info@shipmentx.com', platformOrgId, 'sx_owner', 'ShipmentX', 'Admin')

  const vehicles = await ensureVehicles(sierra.id, [
    { nickname: 'Freightliner Cascadia', year: 2022, make: 'Freightliner', model: 'Cascadia 126', cab_type: 'sleeper', color: 'Blue' },
    { nickname: 'Peterbilt 579', year: 2021, make: 'Peterbilt', model: '579', cab_type: 'day_cab', color: 'Red' },
  ])
  await ensureDemoCompliance(sierra.id, driverId, driverProfileId, vehicles)
  const customerOrgId = await ensureCustomer(sierra.id, { name: 'Sierra Steel Fabricators', city: 'Dallas', state: 'TX' })
  const loads = await ensureLoads(sierra.id, customerOrgId, driverId, vehicles[0]?.id, [
    { status: 'invoiced', pickupDate: dateOnly(daysAgo(6)), deliveryDate: dateOnly(daysAgo(5)), createdAt: daysAgo(6) },
    { status: 'dispatched', pickupDate: dateOnly(daysAgo(1)), deliveryDate: dateOnly(daysFromNow(1)), createdAt: daysAgo(1) },
    { status: 'draft', pickupDate: dateOnly(daysFromNow(3)), deliveryDate: dateOnly(daysFromNow(4)), createdAt: daysAgo(0) },
  ])

  await ensureWebhook(sierra.id, ownerId)
  const dispatchedLoad = loads.find((l) => l.status === 'dispatched') ?? loads[1]
  if (dispatchedLoad) await ensureDriverMessage(sierra.id, dispatchedLoad.id, driverProfileId)

  return { sierraOrgId: sierra.id, ownerId, driverProfileId, driverId }
}

async function seedExtraOrg({ name, carrierDetails, loadStatuses, driverName }) {
  console.log(`Ensuring ${name}...`)
  const org = await ensureCarrierOrg(name, carrierDetails)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const ownerId = await ensureUser(`${slug}-owner@demo.carrieros.dev`, org.id, 'owner', name.split(' ')[0], 'Owner')
  const driverProfileId = await ensureUser(`${slug}-driver@demo.carrieros.dev`, org.id, 'driver', driverName[0], driverName[1])
  const driverId = await ensureDriver(org.id, driverProfileId)
  const vehicles = await ensureVehicles(org.id, [{ nickname: `${name} Truck 1`, year: 2020, make: 'Kenworth' }])
  await ensureDemoCompliance(org.id, driverId, driverProfileId, vehicles)
  const customerOrgId = await ensureCustomer(org.id, { name: `${name} Shipper Co`, city: 'Fort Worth', state: 'TX' })
  const loads = await ensureLoads(
    org.id,
    customerOrgId,
    driverId,
    vehicles[0]?.id,
    loadStatuses.map((status, i) => ({
      status,
      pickupDate: dateOnly(daysAgo(10 - i)),
      deliveryDate: dateOnly(daysAgo(9 - i)),
      createdAt: daysAgo(10 - i),
    }))
  )
  return { orgId: org.id, ownerId, driverProfileId, driverId, loads }
}

async function main() {
  if (RESET) await resetExtraOrgs()

  await seedPersistentAccounts()

  await seedExtraOrg({
    name: 'Trailhead Transport',
    carrierDetails: { tier: 'growth', billing_status: 'trialing', trial_ends_at: daysFromNow(4) },
    loadStatuses: ['dispatched', 'delivered'],
    driverName: ['Priya', 'Nair'],
  })

  const redline = await seedExtraOrg({
    name: 'Redline Logistics',
    carrierDetails: { tier: 'starter', billing_status: 'past_due', grace_period_until: daysFromNow(3) },
    loadStatuses: ['delivered', 'invoiced'],
    driverName: ['Carlos', 'Mendez'],
  })
  await ensureSupportTicket(redline.orgId, redline.ownerId)

  const bluepeak = await seedExtraOrg({
    name: 'Bluepeak Carriers',
    carrierDetails: { tier: 'starter' },
    loadStatuses: ['delivered', 'delivered', 'invoiced', 'invoiced', 'dispatched', 'dispatched', 'draft', 'draft', 'delivered'],
    driverName: ['Dana', 'Whitfield'],
  })
  // Pipeline's "upgrade candidate" needs a SECOND active driver, not just
  // load volume, to also demonstrate that branch of the OR condition.
  const bluepeakSecondDriverProfileId = await ensureUser('bluepeak-carriers-driver2@demo.carrieros.dev', bluepeak.orgId, 'driver', 'Second', 'Driver')
  const bluepeakSecondDriverId = await ensureDriver(bluepeak.orgId, bluepeakSecondDriverProfileId)
  await ensureDemoCompliance(bluepeak.orgId, bluepeakSecondDriverId, bluepeakSecondDriverProfileId, [])
  await ensureInvoices(bluepeak.orgId, bluepeak.loads)

  await seedExtraOrg({
    name: 'Cascade Freightways',
    carrierDetails: { tier: 'growth' },
    loadStatuses: ['delivered', 'dispatched'],
    driverName: ['Jordan', 'Lee'],
  })

  console.log('\nDone.')
  console.log('Persistent accounts (all password Demo123!):')
  console.log('  demo@carrieros.dev            owner, Sierra Freight Co (growth, healthy)')
  console.log('  mike.driver@carrieros.dev     driver, same org')
  console.log('  info@shipmentx.com            sx_owner, ShipmentX -- log in here to see /admin')
  console.log('Extra demo orgs for /admin screens (owner logins: <slug>-owner@demo.carrieros.dev / Demo123!):')
  console.log('  Trailhead Transport  -- trialing, trial ends in ~4 days')
  console.log('  Redline Logistics    -- past_due + grace period + 1 open support ticket')
  console.log('  Bluepeak Carriers    -- starter, high load volume + 2 drivers (upgrade candidate) + invoices in all 4 states')
  console.log('  Cascade Freightways  -- growth, healthy/unremarkable')
}

main().catch((e) => {
  console.error('LOAD-DEMO-DATA FAILED:', e.message)
  process.exit(1)
})
