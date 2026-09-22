// tests/support-tickets-creation.golden.test.ts
// End-to-end proof that POST /api/support/tickets actually works against the REAL Anthropic API
// (real tokens, real latency) — split out of tests/support-tickets-api.test.ts specifically so that
// file can stay in the default `npm test` run while this one, like tests/extraction.golden.test.ts,
// stays out of it. Run explicitly: `npm run test:support-triage`.
//
// Everything else about ticket creation (validation, auth, cross-org 404s, reply/escalate/status RLS
// boundaries) is already covered without AI cost in tests/support-tickets-api.test.ts and
// tests/support-tickets-isolation.test.ts — this file exists only to prove the real classification
// call is wired up correctly end-to-end, not to re-test what those already cover for free.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

let org: TestOrg
let otherOrg: TestOrg
let driver: TestUser
let otherOwner: TestUser
let driverSession: Awaited<ReturnType<typeof signInAs>>
let otherOwnerSession: Awaited<ReturnType<typeof signInAs>>

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  otherOrg = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  driver = await createTestUser(admin, org.orgId, 'driver')
  otherOwner = await createTestUser(admin, otherOrg.orgId, 'owner')
  ;[driverSession, otherOwnerSession] = await Promise.all([signInAs(driver), signInAs(otherOwner)])
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
  await cleanupTestOrg(admin, otherOrg.orgId)
})

describe('POST /api/support/tickets — end-to-end against the real Anthropic API', () => {
  let createdTicketId: number

  it('creates a ticket, captures identity/context automatically, and persists a valid queue', async () => {
    const res = await apiFetch('/api/support/tickets', driverSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ category: 'technical_issue', body: 'How do I add a new driver to my fleet in the app?' }),
    })
    expect(res.status).toBe(201)
    const { ticket } = await res.json()
    createdTicketId = ticket.id

    expect(ticket.submitted_by).toBe(driver.userId)
    expect(ticket.carrier_org_id).toBe(org.orgId)
    // Captured automatically, never supplied by the client (T16).
    expect(ticket.submitter_role).toBe('driver')
    expect(['carrieros_support', 'org_support', 'ai_resolved']).toContain(ticket.queue)
    // org is 'starter' tier -- org_support is not a valid target at all below Enterprise.
    expect(ticket.queue).not.toBe('org_support')
    if (ticket.queue === 'ai_resolved') {
      expect(ticket.fallback_queue).toBe('carrieros_support')
      expect(typeof ticket.ai_answer).toBe('string')
    } else {
      expect(ticket.fallback_queue).toBeNull()
    }
  }, 30_000)

  it('the submitter can then GET their own ticket detail with its thread', async () => {
    const res = await apiFetch(`/api/support/tickets/${createdTicketId}`, driverSession.accessToken)
    expect(res.status).toBe(200)
    const { ticket, messages } = await res.json()
    expect(ticket.id).toBe(createdTicketId)
    expect(Array.isArray(messages)).toBe(true)
  })

  it("another org's user cannot GET this ticket", async () => {
    const res = await apiFetch(`/api/support/tickets/${createdTicketId}`, otherOwnerSession.accessToken)
    expect(res.status).toBe(404)
  })
})
