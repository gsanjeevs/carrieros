// tests/support-tickets-api.test.ts
// Route-level tests for the in-app support ticketing surface (decisions.md T16) — against a REAL
// running `next dev` instance (TEST_APP_URL), same shape as tests/branding.test.ts and
// tests/admin-feature-overrides.test.ts.
//
// AI-cost note: NONE of the tests in this file reach the real Anthropic API — every case either
// exercises a validation/auth path that fails before the classification call, or sets up ticket rows
// directly via the admin client (bypassing POST /api/support/tickets entirely) to test the RLS-backed
// reply/status/escalate endpoints without spending tokens. The actual end-to-end creation call (which
// DOES hit the real API) lives in tests/support-tickets-creation.golden.test.ts, deliberately excluded
// from the default `npm test` run for the same cost/reliability reason tests/extraction.golden.test.ts
// already is — run it explicitly via `npm run test:support-triage`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'
import type { TablesInsert } from '@/types/supabase'

const admin = adminClient()

let org: TestOrg
let otherOrg: TestOrg
let owner: TestUser
let driver: TestUser
let otherOwner: TestUser
let ownerSession: Awaited<ReturnType<typeof signInAs>>
let driverSession: Awaited<ReturnType<typeof signInAs>>
let otherOwnerSession: Awaited<ReturnType<typeof signInAs>>

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  otherOrg = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  owner = await createTestUser(admin, org.orgId, 'owner')
  driver = await createTestUser(admin, org.orgId, 'driver')
  otherOwner = await createTestUser(admin, otherOrg.orgId, 'owner')
  ;[ownerSession, driverSession, otherOwnerSession] = await Promise.all([
    signInAs(owner), signInAs(driver), signInAs(otherOwner),
  ])
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
  await cleanupTestOrg(admin, otherOrg.orgId)
})

describe('POST /api/support/tickets — validation and auth (no AI call reached)', () => {
  it('requires authentication', async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/support/tickets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('rejects an invalid category', async () => {
    const res = await apiFetch('/api/support/tickets', driverSession.accessToken, {
      method: 'POST', body: JSON.stringify({ category: 'not_a_real_category', body: 'this is a long enough body' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error_code).toBe('VALIDATION_ERROR')
  })

  it('rejects a too-short body', async () => {
    const res = await apiFetch('/api/support/tickets', driverSession.accessToken, {
      method: 'POST', body: JSON.stringify({ category: 'other', body: 'short' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('reply / escalate / status routes (RLS-backed, no new AI calls — tickets seeded directly)', () => {
  let carrierosTicketId: number
  let aiResolvedTicketId: number
  let orgSupportTicketId: number

  beforeAll(async () => {
    const insert = async (fields: Partial<TablesInsert<'support_tickets'>> & Pick<TablesInsert<'support_tickets'>, 'submitted_by' | 'carrier_org_id' | 'submitter_role' | 'queue'>) => {
      const { data, error } = await admin.from('support_tickets').insert({
        category: 'technical_issue', body: 'seeded ticket for route testing', ...fields,
      }).select('id').single()
      if (error || !data) throw new Error(error?.message)
      return Number(data.id)
    }
    carrierosTicketId = await insert({ submitted_by: driver.userId, carrier_org_id: org.orgId, submitter_role: 'driver', queue: 'carrieros_support', status: 'open' })
    aiResolvedTicketId = await insert({ submitted_by: driver.userId, carrier_org_id: org.orgId, submitter_role: 'driver', queue: 'ai_resolved', fallback_queue: 'carrieros_support', status: 'resolved', ai_confidence: 0.9, ai_answer: 'canned answer' })
    // Enterprise-flip org just for this one org_support-queue row.
    await admin.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', org.orgId)
    orgSupportTicketId = await insert({ submitted_by: driver.userId, carrier_org_id: org.orgId, submitter_role: 'driver', queue: 'org_support', status: 'open' })
  })

  afterAll(async () => {
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', org.orgId)
  })

  it('the submitter can reply to their own ticket', async () => {
    const res = await apiFetch(`/api/support/tickets/${carrierosTicketId}/reply`, driverSession.accessToken, {
      method: 'POST', body: JSON.stringify({ body: 'adding more detail' }),
    })
    expect(res.status).toBe(201)
  })

  it("another org's user cannot reply (RLS denies the insert -> FORBIDDEN)", async () => {
    const res = await apiFetch(`/api/support/tickets/${carrierosTicketId}/reply`, otherOwnerSession.accessToken, {
      method: 'POST', body: JSON.stringify({ body: 'not my ticket' }),
    })
    expect(res.status).toBe(403)
  })

  it('org owner (org_support_manage, now Enterprise) can update the org_support ticket status', async () => {
    const res = await apiFetch(`/api/support/tickets/${orgSupportTicketId}`, ownerSession.accessToken, {
      method: 'PATCH', body: JSON.stringify({ status: 'resolved' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).ticket.status).toBe('resolved')
  })

  it("another org's owner gets 404 patching a status they can't see", async () => {
    const res = await apiFetch(`/api/support/tickets/${orgSupportTicketId}`, otherOwnerSession.accessToken, {
      method: 'PATCH', body: JSON.stringify({ status: 'closed' }),
    })
    expect(res.status).toBe(404)
  })

  it('escalate reopens an ai_resolved ticket into its fallback_queue', async () => {
    const res = await apiFetch(`/api/support/tickets/${aiResolvedTicketId}/escalate`, driverSession.accessToken, { method: 'POST' })
    expect(res.status).toBe(200)
    const { ticket } = await res.json()
    expect(ticket.queue).toBe('carrieros_support')
    expect(ticket.status).toBe('open')
  })

  it('escalate is rejected for a ticket that is not eligible (already carrieros_support)', async () => {
    const res = await apiFetch(`/api/support/tickets/${carrierosTicketId}/escalate`, driverSession.accessToken, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).error_code).toBe('NOT_ELIGIBLE')
  })
})

describe('GET /api/support/org-queue — Enterprise-gated staff console list', () => {
  it('a non-Enterprise org owner sees an empty list (RLS has_feature gate), not an error', async () => {
    const res = await apiFetch('/api/support/org-queue', otherOwnerSession.accessToken)
    expect(res.status).toBe(200)
    expect((await res.json()).tickets).toEqual([])
  })
})
