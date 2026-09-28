// tests/webhooks.test.ts — org-level outbound webhooks (Settings > Integrations, migration 0037).
//
// Covers three things that can't be meaningfully asserted with mocks:
//   1. CRUD via /api/v1/webhooks, and org isolation (RLS: org A cannot see/edit org B's webhooks).
//   2. signPayload() — a pure function, unit-tested directly (no server needed).
//   3. Triggering a wired domain event (invoice mark-paid) actually creates a webhook_deliveries row.
//      The webhook URL points at an unreachable host on purpose — WebhookDispatchService's job here
//      is to record the ATTEMPT (status='failed', attempt_count=3) durably, not to require a real
//      HTTP round-trip to succeed; that keeps this test fast and independent of network access.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, type TestOrg, type TestUser } from './helpers'
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from '@/server/application/webhook-dispatch-service'
import { createHmac } from 'node:crypto'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'

const admin = adminClient()

let orgA: TestOrg
let orgB: TestOrg
let ownerA: TestUser
let ownerB: TestUser
let tokenA: string
let tokenB: string

function api(token: string, method: string, path: string, body?: unknown) {
  return fetch(`${APP}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function pollDeliveries(webhookId: number, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const { data } = await admin.from('webhook_deliveries').select('*').eq('webhook_id', webhookId)
    if (data && data.length > 0 && data[0].status !== 'pending') return data
    await new Promise((r) => setTimeout(r, 300))
  }
  const { data } = await admin.from('webhook_deliveries').select('*').eq('webhook_id', webhookId)
  return data ?? []
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  orgB = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  ownerA = await createTestUser(admin, orgA.orgId, 'owner')
  ownerB = await createTestUser(admin, orgB.orgId, 'owner')
  tokenA = (await signInAs(ownerA)).accessToken
  tokenB = (await signInAs(ownerB)).accessToken
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('signPayload', () => {
  it('is a deterministic hex HMAC-SHA256 of the raw body under the given secret', () => {
    const body = JSON.stringify({ event: 'invoice.paid', data: { invoiceId: 1 } })
    const expected = createHmac('sha256', 'my-secret').update(body, 'utf8').digest('hex')
    expect(signPayload(body, 'my-secret')).toBe(expected)
    // Same body, different secret => different signature.
    expect(signPayload(body, 'other-secret')).not.toBe(expected)
    // Same secret, different body => different signature.
    expect(signPayload(JSON.stringify({ event: 'invoice.paid', data: { invoiceId: 2 } }), 'my-secret')).not.toBe(expected)
  })

  it('matches the header name the dispatcher actually sends', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('X-CarrierOS-Signature')
  })
})

describe('/api/v1/webhooks CRUD + org isolation', () => {
  let webhookId: number

  it('creates a webhook and returns the secret exactly once', async () => {
    const res = await api(tokenA, 'POST', '/api/v1/webhooks', {
      url: 'https://example.com/hooks/carrieros',
      subscribed_events: ['invoice.paid', 'load.delivered'],
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.webhook.url).toBe('https://example.com/hooks/carrieros')
    expect(json.webhook.subscribed_events).toEqual(['invoice.paid', 'load.delivered'])
    expect(json.webhook.enabled).toBe(true)
    expect(typeof json.secret).toBe('string')
    expect(json.secret.length).toBeGreaterThan(10)
    webhookId = json.webhook.id
  })

  it('lists the webhook for its own org', async () => {
    const res = await api(tokenA, 'GET', '/api/v1/webhooks')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.webhooks.some((w: { id: number }) => w.id === webhookId)).toBe(true)
  })

  it('org B cannot see org A\'s webhook', async () => {
    const res = await api(tokenB, 'GET', '/api/v1/webhooks')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.webhooks.some((w: { id: number }) => w.id === webhookId)).toBe(false)
  })

  it('org B cannot edit or delete org A\'s webhook (RLS-scoped, answers 404 either way)', async () => {
    const patchRes = await api(tokenB, 'PATCH', `/api/v1/webhooks/${webhookId}`, { enabled: false })
    expect(patchRes.status).toBe(404)

    const deleteRes = await api(tokenB, 'DELETE', `/api/v1/webhooks/${webhookId}`)
    expect(deleteRes.status).toBe(404)

    // Confirm org A's webhook is untouched.
    const { data } = await admin.from('webhooks').select('enabled').eq('id', webhookId).single()
    expect(data?.enabled).toBe(true)
  })

  it('org A can update its own webhook', async () => {
    const res = await api(tokenA, 'PATCH', `/api/v1/webhooks/${webhookId}`, { subscribed_events: ['invoice.paid'] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.webhook.subscribed_events).toEqual(['invoice.paid'])
  })

  it('rotating the secret returns a new secret and changes the preview', async () => {
    const before = await (await api(tokenA, 'GET', '/api/v1/webhooks')).json()
    const previewBefore = before.webhooks.find((w: { id: number }) => w.id === webhookId).secret_preview

    const res = await api(tokenA, 'POST', `/api/v1/webhooks/${webhookId}/rotate-secret`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.secret).toBe('string')
    expect(json.webhook.secret_preview).not.toBe(previewBefore)
  })

  it('org A can delete its own webhook', async () => {
    const res = await api(tokenA, 'DELETE', `/api/v1/webhooks/${webhookId}`)
    expect(res.status).toBe(200)
    const { data } = await admin.from('webhooks').select('id').eq('id', webhookId).maybeSingle()
    expect(data).toBeNull()
  })
})

describe('wired domain event: invoice mark-paid dispatches a webhook delivery', () => {
  it('creates a webhook_deliveries row (failed, after 3 attempts) for invoice.paid', async () => {
    // Register a webhook pointed at an address that cannot possibly answer — proving the ATTEMPT
    // and its bounded retry/record behavior, not requiring a live receiver.
    const createRes = await api(tokenA, 'POST', '/api/v1/webhooks', {
      url: 'http://127.0.0.1:1/unreachable',
      subscribed_events: ['invoice.paid'],
    })
    expect(createRes.status).toBe(201)
    const { webhook } = await createRes.json()

    const { data: load, error: loadErr } = await admin
      .from('loads')
      .insert({ carrier_org_id: orgA.orgId, load_number: `WH-${Date.now()}`, status: 'delivered', rate: 1200 })
      .select('id')
      .single()
    if (loadErr || !load) throw new Error(`load insert: ${loadErr?.message}`)

    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .insert({
        carrier_org_id: orgA.orgId,
        load_id: load.id,
        invoice_number: `INV-WH-${Date.now()}`,
        amount: 1200,
        status: 'sent',
      })
      .select('id')
      .single()
    if (invErr || !invoice) throw new Error(`invoice insert: ${invErr?.message}`)

    const markPaidRes = await api(tokenA, 'POST', `/api/v1/invoices/${invoice.id}/mark-paid`)
    expect(markPaidRes.status).toBe(200)
    const markPaidJson = await markPaidRes.json()
    expect(markPaidJson.outcome).toBe('APPLIED')

    // Dispatch is fire-and-forget from the route's perspective — poll for the delivery record.
    const deliveries = await pollDeliveries(webhook.id)
    expect(deliveries.length).toBeGreaterThan(0)
    const delivery = deliveries[0]
    expect(delivery.event_type).toBe('invoice.paid')
    expect(delivery.status).toBe('failed')
    expect(delivery.attempt_count).toBe(3)
    expect(delivery.payload).toMatchObject({ invoiceId: invoice.id })

    await admin.from('webhooks').delete().eq('id', webhook.id)
  }, 60_000)
})
