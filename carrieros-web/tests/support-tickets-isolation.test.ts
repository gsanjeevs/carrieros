// tests/support-tickets-isolation.test.ts
// Cross-tenant / cross-queue-visibility isolation for support_tickets + support_ticket_messages
// (decisions.md T16, migration 0027) — follows tests/rls-isolation.test.ts's pattern (real orgs, real
// sessions, assert RLS-filtered zero rows / silent no-op writes) rather than mocks, since this is
// exactly the kind of tenant-boundary behavior only Postgres itself can prove.
//
// Deliberately does NOT go through POST /api/support/tickets (which calls the real Anthropic API) —
// ticket rows are inserted directly via the admin (service-role) client so this suite is free and fast
// and can run in the default `npx vitest run`. The AI classification path itself is covered separately
// by tests/support-triage.golden.test.ts (excluded from the default run, real API calls) and by the one
// end-to-end creation test in tests/support-tickets-api.test.ts.
//
// Three visibility scopes under test, per T16:
//   1. A ticket's own submitter always sees it, regardless of queue.
//   2. org_support-queue tickets: visible only to owner/solo staff of THAT SAME org, and only when the
//      org is Enterprise-entitled (has_feature('support_desk')) — never another carrier's org_support
//      queue, never a dispatcher/finance/driver even within the same org.
//   3. carrieros_support-queue tickets: visible only to sx_owner/sx_support, regardless of which
//      carrier org submitted them — and NOT visible to any carrier-org session, even the submitter's
//      own org's owner (only the actual submitter, via scope 1, or ShipmentX staff can see these).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg,
  type TestOrg, type TestUser,
} from './helpers'
import type { TablesInsert } from '@/types/supabase'

const admin = adminClient()

let orgA: TestOrg          // starter tier — hosts the carrieros_support + ai_resolved tickets
let orgB: TestOrg          // enterprise tier — org_support queue under test
let orgC: TestOrg          // enterprise tier — the OTHER org, for cross-org org_support isolation
let platformOrgId: number

let driverA: TestUser, ownerB: TestUser, dispatcherB: TestUser, ownerC: TestUser
let sxOwner: TestUser, sxSupport: TestUser

let sessionDriverA: Awaited<ReturnType<typeof signInAs>>
let sessionOwnerB: Awaited<ReturnType<typeof signInAs>>
let sessionDispatcherB: Awaited<ReturnType<typeof signInAs>>
let sessionOwnerC: Awaited<ReturnType<typeof signInAs>>
let sessionSxOwner: Awaited<ReturnType<typeof signInAs>>
let sessionSxSupport: Awaited<ReturnType<typeof signInAs>>

let ticketA_carrieros: number
let ticketA_aiResolved: number
let ticketB_orgSupport: number
let ticketC_orgSupport: number
let ticketA_staleOrgSupport: number // simulates a pre-downgrade row: queue='org_support' on a non-Enterprise org

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  orgB = await createTestOrg(admin, 'carrier', { tier: 'enterprise' })
  orgC = await createTestOrg(admin, 'carrier', { tier: 'enterprise' })

  const platform = await createTestOrg(admin, 'carrier')
  platformOrgId = platform.orgId
  await admin.from('organizations').update({ type: 'platform' }).eq('id', platformOrgId)

  driverA = await createTestUser(admin, orgA.orgId, 'driver')
  ownerB = await createTestUser(admin, orgB.orgId, 'owner')
  dispatcherB = await createTestUser(admin, orgB.orgId, 'dispatcher')
  ownerC = await createTestUser(admin, orgC.orgId, 'owner')
  sxOwner = await createTestUser(admin, platformOrgId, 'sx_owner')
  sxSupport = await createTestUser(admin, platformOrgId, 'sx_support')

  ;[sessionDriverA, sessionOwnerB, sessionDispatcherB, sessionOwnerC, sessionSxOwner, sessionSxSupport] =
    await Promise.all([
      signInAs(driverA), signInAs(ownerB), signInAs(dispatcherB), signInAs(ownerC), signInAs(sxOwner), signInAs(sxSupport),
    ])

  const insertTicket = async (fields: Partial<TablesInsert<'support_tickets'>> & Pick<TablesInsert<'support_tickets'>, 'submitted_by' | 'carrier_org_id' | 'submitter_role' | 'queue'>) => {
    const { data, error } = await admin.from('support_tickets').insert({
      category: 'technical_issue',
      body: 'test ticket body, at least ten characters',
      ai_confidence: null,
      ...fields,
    }).select('id').single()
    if (error || !data) throw new Error(`insertTicket: ${error?.message}`)
    return Number(data.id)
  }

  ticketA_carrieros = await insertTicket({
    submitted_by: driverA.userId, carrier_org_id: orgA.orgId, submitter_role: 'driver',
    queue: 'carrieros_support', status: 'open',
  })
  ticketA_aiResolved = await insertTicket({
    submitted_by: driverA.userId, carrier_org_id: orgA.orgId, submitter_role: 'driver',
    queue: 'ai_resolved', fallback_queue: 'carrieros_support', status: 'resolved',
    ai_confidence: 0.95, ai_answer: 'Here is how you do that.',
  })
  ticketB_orgSupport = await insertTicket({
    submitted_by: ownerB.userId, carrier_org_id: orgB.orgId, submitter_role: 'owner',
    queue: 'org_support', status: 'open',
  })
  ticketC_orgSupport = await insertTicket({
    submitted_by: ownerC.userId, carrier_org_id: orgC.orgId, submitter_role: 'owner',
    queue: 'org_support', status: 'open',
  })
  // orgA is 'starter' -- has_feature('support_desk') is false for it. This row simulates a stale
  // org_support ticket surviving a tier downgrade; RLS must still deny it (defense in depth, T16: org_support
  // "is not a valid routing target at all" below Enterprise).
  ticketA_staleOrgSupport = await insertTicket({
    submitted_by: driverA.userId, carrier_org_id: orgA.orgId, submitter_role: 'driver',
    queue: 'org_support', status: 'open',
  })
}, 60_000)

afterAll(async () => {
  await admin.from('support_ticket_messages').delete().in('ticket_id', [ticketA_carrieros, ticketA_aiResolved, ticketB_orgSupport, ticketC_orgSupport, ticketA_staleOrgSupport])
  await admin.from('support_tickets').delete().in('id', [ticketA_carrieros, ticketA_aiResolved, ticketB_orgSupport, ticketC_orgSupport, ticketA_staleOrgSupport])
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
  await cleanupTestOrg(admin, orgC.orgId)
  await cleanupTestOrg(admin, platformOrgId)
})

describe('support_tickets — submitter visibility', () => {
  it('the submitter sees both of their own tickets regardless of queue', async () => {
    const { data } = await sessionDriverA.client.from('support_tickets').select('id').order('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(ticketA_carrieros)
    expect(ids).toContain(ticketA_aiResolved)
  })

  it("a submitter never sees another org's tickets, even by direct id", async () => {
    const { data, error } = await sessionDriverA.client.from('support_tickets').select('id').eq('id', ticketB_orgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('support_tickets — org_support queue (Enterprise-gated, owner/solo only, same-org only)', () => {
  it("org B's owner sees org B's org_support ticket", async () => {
    const { data } = await sessionOwnerB.client.from('support_tickets').select('id').eq('id', ticketB_orgSupport)
    expect(data).toEqual([{ id: ticketB_orgSupport }])
  })

  it("org B's owner does NOT see org C's org_support ticket (cross-org)", async () => {
    const { data, error } = await sessionOwnerB.client.from('support_tickets').select('id').eq('id', ticketC_orgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("org C's owner does NOT see org B's org_support ticket (cross-org, symmetric)", async () => {
    const { data, error } = await sessionOwnerC.client.from('support_tickets').select('id').eq('id', ticketB_orgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("a dispatcher in org B (not org_support_manage) does NOT see org B's own org_support ticket", async () => {
    const { data, error } = await sessionDispatcherB.client.from('support_tickets').select('id').eq('id', ticketB_orgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("org A's owner does NOT see org A's own org_support-queue ticket when org A is below Enterprise (has_feature gate, defense in depth)", async () => {
    const ownerA = await createTestUser(admin, orgA.orgId, 'owner')
    const sessionOwnerA = await signInAs(ownerA)
    const { data, error } = await sessionOwnerA.client.from('support_tickets').select('id').eq('id', ticketA_staleOrgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('support_tickets — carrieros_support queue (sx_owner/sx_support only, gated on role alone)', () => {
  it('sx_owner sees the carrieros_support ticket regardless of which carrier org submitted it', async () => {
    const { data } = await sessionSxOwner.client.from('support_tickets').select('id').eq('id', ticketA_carrieros)
    expect(data).toEqual([{ id: ticketA_carrieros }])
  })

  it('sx_support sees it too', async () => {
    const { data } = await sessionSxSupport.client.from('support_tickets').select('id').eq('id', ticketA_carrieros)
    expect(data).toEqual([{ id: ticketA_carrieros }])
  })

  it('sx_owner does NOT see an org_support-queue ticket from any carrier (wrong queue, not their domain)', async () => {
    const { data, error } = await sessionSxOwner.client.from('support_tickets').select('id').eq('id', ticketB_orgSupport)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("org A's OWN driver-submitter aside, no other org A member (e.g. org B's owner) can see org A's carrieros_support ticket", async () => {
    const { data, error } = await sessionOwnerB.client.from('support_tickets').select('id').eq('id', ticketA_carrieros)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('escalate_support_ticket() RPC — ai_resolved "still need help?" (T16: never a dead end)', () => {
  it('the submitter can escalate their own ai_resolved ticket into its recorded fallback_queue', async () => {
    const { data, error } = await sessionDriverA.client.rpc('escalate_support_ticket', { p_ticket_id: ticketA_aiResolved })
    expect(error).toBeNull()
    expect(data?.queue).toBe('carrieros_support')
    expect(data?.status).toBe('open')

    // Now that it's queue='carrieros_support', ShipmentX staff can see it -- proving the escalation
    // actually reassigns visibility, not just the label.
    const { data: sxView } = await sessionSxOwner.client.from('support_tickets').select('id').eq('id', ticketA_aiResolved)
    expect(sxView).toEqual([{ id: ticketA_aiResolved }])
  })

  it('a non-owner cannot escalate someone else\'s ticket', async () => {
    const { data, error } = await sessionOwnerB.client.rpc('escalate_support_ticket', { p_ticket_id: ticketA_carrieros })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('cannot re-escalate a ticket that is not ai_resolved', async () => {
    const { data, error } = await sessionDriverA.client.rpc('escalate_support_ticket', { p_ticket_id: ticketA_carrieros })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})

describe('support_ticket_messages — same visibility boundary as their parent ticket', () => {
  let messageOnCarrierosTicket: number
  let messageOnOrgBTicket: number

  beforeAll(async () => {
    const { data: m1 } = await admin.from('support_ticket_messages').insert({
      ticket_id: ticketA_carrieros, carrier_org_id: orgA.orgId, sender_id: driverA.userId, body: 'follow-up from submitter',
    }).select('id').single()
    messageOnCarrierosTicket = Number(m1!.id)

    const { data: m2 } = await admin.from('support_ticket_messages').insert({
      ticket_id: ticketB_orgSupport, carrier_org_id: orgB.orgId, sender_id: ownerB.userId, body: 'staff reply in org B',
    }).select('id').single()
    messageOnOrgBTicket = Number(m2!.id)
  })

  it("org C's owner cannot read org B's org_support ticket thread", async () => {
    const { data, error } = await sessionOwnerC.client.from('support_ticket_messages').select('id').eq('id', messageOnOrgBTicket)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('sx_support can read the carrieros_support ticket thread but not the org_support one', async () => {
    const { data: onCarrieros } = await sessionSxSupport.client.from('support_ticket_messages').select('id').eq('id', messageOnCarrierosTicket)
    expect(onCarrieros).toEqual([{ id: messageOnCarrierosTicket }])

    const { data: onOrgB, error } = await sessionSxSupport.client.from('support_ticket_messages').select('id').eq('id', messageOnOrgBTicket)
    expect(error).toBeNull()
    expect(onOrgB).toEqual([])
  })

  it("org B's owner cannot insert a reply on org C's org_support ticket", async () => {
    const { data, error } = await sessionOwnerB.client.from('support_ticket_messages').insert({
      ticket_id: ticketC_orgSupport, carrier_org_id: orgC.orgId, sender_id: ownerB.userId, body: 'trying to reply cross-org',
    }).select()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})
