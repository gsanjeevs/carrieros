// tests/billing.test.ts
// Gate 0→1 — billing/subscription role gating (lib/roles-policy.ts's
// SUBSCRIPTION_ROLES, resolved from the BILLING_ROLES drift found and fixed
// this session) and tier-change validation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()
let org: TestOrg
let owner: TestUser
let dispatcher: TestUser
let ownerSession: Awaited<ReturnType<typeof signInAs>>
let dispatcherSession: Awaited<ReturnType<typeof signInAs>>

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  owner = await createTestUser(admin, org.orgId, 'owner')
  dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
  ownerSession = await signInAs(owner)
  dispatcherSession = await signInAs(dispatcher)
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

describe('POST /api/billing/change-tier', () => {
  it('rejects a dispatcher (SUBSCRIPTION_ROLES is owner/solo only, not finance/dispatcher)', async () => {
    const res = await apiFetch('/api/billing/change-tier', dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ tier: 'growth' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects an unknown tier value', async () => {
    const res = await apiFetch('/api/billing/change-tier', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ tier: 'not_a_real_tier' }),
    })
    expect(res.status).toBe(400)
  })

  it('allows the owner to change tier, and it actually persists', async () => {
    const res = await apiFetch('/api/billing/change-tier', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ tier: 'growth' }),
    })
    expect(res.status).toBe(200)
    const { data } = await admin.from('carrier_details').select('tier').eq('org_id', org.orgId).single()
    expect(data?.tier).toBe('growth')
  })
})

describe('POST /api/billing/add-payment-method', () => {
  it('rejects a dispatcher', async () => {
    const res = await apiFetch('/api/billing/add-payment-method', dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('allows the owner and writes a demo Stripe customer id', async () => {
    const res = await apiFetch('/api/billing/add-payment-method', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const { data } = await admin.from('carrier_details').select('stripe_customer_id, card_brand').eq('org_id', org.orgId).single()
    expect(data?.stripe_customer_id).toMatch(/^demo_cus_/)
    expect(data?.card_brand).toBe('visa')
  })
})
