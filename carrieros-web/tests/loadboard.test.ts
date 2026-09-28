// tests/loadboard.test.ts — DAT load-board integration, Phase 1 (posting only, mocked client,
// migration 0052/0053). Covers what mocks can't meaningfully substitute for:
//   1. Authorization: loadboard_posting capability (owner/solo/dispatcher only, NOT finance/driver)
//      AND the Growth+ feature gate, both enforced by LoadboardIntegrationService/
//      LoadboardPostingService's authorize() -- see server/application/loadboard-service.ts.
//   2. Credential rotation convention via PUT /api/v1/loadboard-integrations: first-time setup
//      requires api_key, an enabled-only PUT leaves the stored credential untouched, an empty-string
//      api_key clears it -- same convention as tests would assert for telematics-integrations.
//   3. The mock posting flow end to end: POST /api/v1/loads/{id}/loadboard-postings calls
//      MockDatClient, records loadboard_postings, and a second POST for the same load is rejected
//      (already posted) -- the loadboard_postings_load_provider_unique constraint's business meaning.
// Cross-tenant RLS isolation for loadboard_integrations/loadboard_postings is covered at the RLS
// layer in tests/rls-isolation.test.ts (org B session cannot read/write org A's rows, and the
// migration 0053 tenancy trigger rejects a cross-org load_id) -- not duplicated here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, apiFetch, createTestOrg, createTestUser, signInAs, cleanupTestOrg, type TestOrg, type TestUser } from './helpers'

const admin = adminClient()

let growthOrg: TestOrg
let starterOrg: TestOrg
let owner: TestUser
let dispatcher: TestUser
let finance: TestUser
let starterOwner: TestUser
let ownerToken: string
let dispatcherToken: string
let financeToken: string
let starterOwnerToken: string

function api(token: string, method: string, path: string, body?: unknown) {
  return apiFetch(path, token, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

beforeAll(async () => {
  growthOrg = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  starterOrg = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  owner = await createTestUser(admin, growthOrg.orgId, 'owner')
  dispatcher = await createTestUser(admin, growthOrg.orgId, 'dispatcher')
  finance = await createTestUser(admin, growthOrg.orgId, 'finance')
  starterOwner = await createTestUser(admin, starterOrg.orgId, 'owner')
  ownerToken = (await signInAs(owner)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  financeToken = (await signInAs(finance)).accessToken
  starterOwnerToken = (await signInAs(starterOwner)).accessToken
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, growthOrg.orgId)
  await cleanupTestOrg(admin, starterOrg.orgId)
})

describe('authorization', () => {
  it('finance (no loadboard_posting capability) is forbidden even on a Growth+ org', async () => {
    const res = await api(financeToken, 'GET', '/api/v1/loadboard-integrations')
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error_code).toBe('FORBIDDEN')
  })

  it('owner on a starter-tier org (has the capability, not the entitlement) gets a tier-upgrade error', async () => {
    const res = await api(starterOwnerToken, 'GET', '/api/v1/loadboard-integrations')
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.error_code).toBe('TIER_UPGRADE_REQUIRED')
  })

  it('dispatcher on a Growth+ org (has both capability and entitlement) can list', async () => {
    const res = await api(dispatcherToken, 'GET', '/api/v1/loadboard-integrations')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.integrations).toEqual([])
  })
})

describe('credential rotation convention', () => {
  it('rejects first-time setup with no api_key', async () => {
    const res = await api(ownerToken, 'PUT', '/api/v1/loadboard-integrations', { provider: 'dat', enabled: true })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('sets up the DAT credential for the first time', async () => {
    const res = await api(ownerToken, 'PUT', '/api/v1/loadboard-integrations', { provider: 'dat', enabled: true, api_key: 'dat-test-key-1' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.integration).toMatchObject({ provider: 'dat', enabled: true, credential_configured: true })

    // Never returned in plaintext or ciphertext.
    expect(json.integration.api_key).toBeUndefined()
    const { data: row } = await admin.from('loadboard_integrations').select('api_key_encrypted').eq('carrier_org_id', growthOrg.orgId).single()
    expect(row?.api_key_encrypted).not.toBe('dat-test-key-1')
    expect(row?.api_key_encrypted?.length).toBeGreaterThan(0)
  })

  it('an enabled-only PUT leaves the stored credential untouched', async () => {
    const before = await admin.from('loadboard_integrations').select('api_key_encrypted').eq('carrier_org_id', growthOrg.orgId).single()

    const res = await api(ownerToken, 'PUT', '/api/v1/loadboard-integrations', { provider: 'dat', enabled: false })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.integration.enabled).toBe(false)
    expect(json.integration.credential_configured).toBe(true)

    const after = await admin.from('loadboard_integrations').select('api_key_encrypted').eq('carrier_org_id', growthOrg.orgId).single()
    expect(after.data?.api_key_encrypted).toBe(before.data?.api_key_encrypted)
  })

  it('an empty-string api_key clears the credential', async () => {
    const res = await api(ownerToken, 'PUT', '/api/v1/loadboard-integrations', { provider: 'dat', enabled: true, api_key: '' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.integration.credential_configured).toBe(false)
  })

  it('rotating back in restores posting eligibility', async () => {
    const res = await api(ownerToken, 'PUT', '/api/v1/loadboard-integrations', { provider: 'dat', enabled: true, api_key: 'dat-test-key-2' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.integration.credential_configured).toBe(true)
  })
})

describe('mock posting flow', () => {
  let loadId: number

  beforeAll(async () => {
    const { data: load, error } = await admin
      .from('loads')
      .insert({
        carrier_org_id: growthOrg.orgId,
        load_number: `LB-${Date.now()}`,
        status: 'draft',
        pickup_city: 'Kansas City',
        pickup_state: 'MO',
        delivery_city: 'Denver',
        delivery_state: 'CO',
        rate: 2200,
      })
      .select('id')
      .single()
    if (error || !load) throw new Error(`load insert: ${error?.message}`)
    loadId = Number(load.id)
  })

  it('reports not-yet-posted before any posting exists', async () => {
    const res = await api(ownerToken, 'GET', `/api/v1/loads/${loadId}/loadboard-postings`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.posting).toBeNull()
  })

  it('posts the load via MockDatClient and records the result', async () => {
    const res = await api(dispatcherToken, 'POST', `/api/v1/loads/${loadId}/loadboard-postings`, { provider: 'dat' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.posting.load_id).toBe(loadId)
    expect(json.posting.provider).toBe('dat')
    expect(json.posting.external_posting_id).toMatch(new RegExp(`^dat-mock-${loadId}-\\d+$`))
    expect(typeof json.posting.posted_at).toBe('string')

    const { data: row } = await admin.from('loadboard_postings').select('external_posting_id').eq('load_id', loadId).single()
    expect(row?.external_posting_id).toBe(json.posting.external_posting_id)
  })

  it('reports already-posted afterward', async () => {
    const res = await api(ownerToken, 'GET', `/api/v1/loads/${loadId}/loadboard-postings`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.posting).not.toBeNull()
    expect(json.posting.load_id).toBe(loadId)
  })

  it('rejects a second post for the same load/provider', async () => {
    const res = await api(ownerToken, 'POST', `/api/v1/loads/${loadId}/loadboard-postings`, { provider: 'dat' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('finance (no loadboard_posting capability) cannot post', async () => {
    const res = await api(financeToken, 'POST', `/api/v1/loads/${loadId}/loadboard-postings`, { provider: 'dat' })
    expect(res.status).toBe(403)
  })
})
