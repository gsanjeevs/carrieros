// tests/extraction.golden.test.ts
// AI-native gate (docs/production-gates.md §3): "any feature relying on an
// LLM call needs a golden-set test, not just 'it looked right when I tried
// it'". This hits the REAL /api/extract-load route — real Anthropic tokens,
// real latency, and inherently a little non-deterministic — so it is
// deliberately excluded from the default `npm test` run (see
// vitest.config.ts's `exclude`). Run explicitly: `npm run test:extraction`.
//
// A prompt or model change that silently degrades accuracy on these 4
// realistic-shaped rate confirmations should fail this test, not go
// unnoticed until a real load gets misextracted in production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg, type TestUser } from './helpers'

const admin = adminClient()
let org: TestOrg
let owner: TestUser
let session: Awaited<ReturnType<typeof signInAs>>

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier')
  owner = await createTestUser(admin, org.orgId, 'owner')
  session = await signInAs(owner)
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

interface GoldenCase {
  name: string
  document: string
  expect: {
    pickup_state?: string
    delivery_state?: string
    rate?: number
    commodity_contains?: string
  }
}

// Each document is a synthetic but realistically-formatted rate
// confirmation — the kind of plain-text broker email/PDF-extract this route
// actually receives. Assertions are on the fields a dispatcher would
// actually rely on (state codes and rate are unambiguous in the source text
// and should extract exactly; commodity is checked with a substring match
// since the model may paraphrase slightly).
const GOLDEN_SET: GoldenCase[] = [
  {
    name: 'clean rate confirmation with full addresses',
    document: `RATE CONFIRMATION #RC-88213
Broker: Golden State Steel Brokers
Pickup: 55 Industrial Way, Bakersfield, CA 93301, 2026-08-01 08:00
Delivery: 310 Port Rd, Long Beach, CA 90802, 2026-08-02 14:00
Commodity: Steel coils, 42,000 lbs
Rate: $1,900.00
Total miles: 210`,
    expect: { pickup_state: 'CA', delivery_state: 'CA', rate: 1900, commodity_contains: 'steel' },
  },
  {
    name: 'informal broker email, cross-state',
    document: `Hey — got a load for you. Picking up produce out of Fresno CA
tomorrow morning, dropping in Portland OR by end of week. Paying
$2,450 flat. Let me know if you can cover it. ~40k lbs on pallets.`,
    expect: { pickup_state: 'CA', delivery_state: 'OR', rate: 2450, commodity_contains: 'produce' },
  },
  {
    name: 'multi-stop with explicit reference number and no dollar sign in body text',
    document: `Load Ref: 9981245
Shipper: West Coast Electronics
Origin: San Jose, CA
Destination: Sacramento, CA
Freight: Electronics components, palletized, 12,000 lbs
Agreed rate: 980 USD
Pickup date: 08/05/2026
Delivery date: 08/05/2026`,
    expect: { pickup_state: 'CA', delivery_state: 'CA', rate: 980, commodity_contains: 'electronic' },
  },
  {
    name: 'long-haul with detention/accessorial noise that should not be mistaken for the line-haul rate',
    document: `Confirmation — Sierra Freight
PU: Bakersfield, CA (08/10 09:00) / DEL: Long Beach, CA (08/11 07:00)
Commodity: Bagged cement, 44,500 lbs
Line haul rate: $1,650.00
Detention: $75/hr after 2 hrs free time
Lumper fee: $150 (if applicable)`,
    expect: { pickup_state: 'CA', delivery_state: 'CA', rate: 1650, commodity_contains: 'cement' },
  },
]

describe('POST /api/extract-load — golden-set accuracy regression', () => {
  it.each(GOLDEN_SET)('$name', async (goldenCase) => {
    const res = await apiFetch('/api/extract-load', session.accessToken, {
      method: 'POST',
      body: JSON.stringify({ text: goldenCase.document }),
    })
    expect(res.status).toBe(200)
    const extracted = await res.json()

    if (goldenCase.expect.pickup_state) {
      expect(extracted.pickup_state).toBe(goldenCase.expect.pickup_state)
    }
    if (goldenCase.expect.delivery_state) {
      expect(extracted.delivery_state).toBe(goldenCase.expect.delivery_state)
    }
    if (goldenCase.expect.rate !== undefined) {
      expect(extracted.rate).toBe(goldenCase.expect.rate)
    }
    if (goldenCase.expect.commodity_contains) {
      expect((extracted.commodity ?? '').toLowerCase()).toContain(goldenCase.expect.commodity_contains)
    }
  }, 30_000)
})
