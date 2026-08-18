// tests/shipment-milestone-command.test.ts
// Integration tests for submit_shipment_milestone (migration 0006).
//
// These run against the real local Postgres, because the properties being
// tested — atomicity, compare-and-swap under concurrency, tenant isolation
// under SECURITY DEFINER — are enforced by the database and cannot be
// meaningfully asserted with mocks. That is the same rationale as the existing
// rls-isolation suite (see vitest.config.ts).
//
// The behaviour under test is what fixes the defect found in the 2026-07-26
// audit: today the mobile screen and the web PATCH route both update `loads`
// and then separately insert `load_events`, so a failure between them leaves a
// status change with no timeline entry.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient,
  createTestOrg,
  createTestUser,
  signInAs,
  cleanupTestOrg,
  cleanupTestUser,
  type TestOrg,
  type TestUser,
} from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const admin = adminClient()

let orgA: TestOrg
let orgB: TestOrg
let dispatcherA: TestUser
let dispatcherB: TestUser
let clientA: SupabaseClient<Database>
let clientB: SupabaseClient<Database>
let loadId: number

async function createLoad(orgId: number, status = 'dispatched'): Promise<number> {
  const { data, error } = await admin
    .from('loads')
    .insert({
      carrier_org_id: orgId,
      load_number: `TEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      status,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createLoad: ${error?.message}`)
  return Number(data.id)
}

function call(
  client: SupabaseClient<Database>,
  args: {
    loadId: number
    expected: string
    next: string
    idempotencyKey: string
    reason?: string | null
  }
) {
  return client.rpc('submit_shipment_milestone' as never, {
    p_load_id: args.loadId,
    p_expected_status: args.expected,
    p_new_status: args.next,
    p_event_type: `status_${args.next}`,
    p_reason: args.reason ?? null,
    p_correlation_id: `test-corr-${args.idempotencyKey}`,
    p_idempotency_key: args.idempotencyKey,
    p_occurred_at: new Date().toISOString(),
  } as never)
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  dispatcherA = await createTestUser(admin, orgA.orgId, 'dispatcher')
  dispatcherB = await createTestUser(admin, orgB.orgId, 'dispatcher')
  clientA = (await signInAs(dispatcherA)).client
  clientB = (await signInAs(dispatcherB)).client
})

afterAll(async () => {
  await cleanupTestUser(admin, dispatcherA.userId)
  await cleanupTestUser(admin, dispatcherB.userId)
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('atomicity — the defect this exists to fix', () => {
  it('writes status, timeline event, outbox event and audit row together', async () => {
    loadId = await createLoad(orgA.orgId, 'dispatched')
    const key = `atomic-${loadId}`

    const { data, error } = await call(clientA, {
      loadId,
      expected: 'dispatched',
      next: 'picked_up',
      idempotencyKey: key,
      reason: 'driver confirmed pickup',
    })
    expect(error).toBeNull()
    expect((data as unknown as { outcome: string }).outcome).toBe('APPLIED')

    // All four writes must be present. Read with admin because outbox and
    // audit are deliberately not client-readable.
    const { data: load } = await admin.from('loads').select('status').eq('id', loadId).single()
    expect(load?.status).toBe('picked_up')

    const { data: events } = await admin
      .from('load_events')
      .select('event_type, note')
      .eq('load_id', loadId)
    expect(events).toHaveLength(1)
    expect(events![0].event_type).toBe('status_picked_up')
    expect(events![0].note).toBe('driver confirmed pickup')

    const { data: outbox } = await admin
      .from('outbox_events')
      .select('event_type, aggregate_id, org_id, payload, status')
      .eq('idempotency_key', key)
      .single()
    expect(outbox?.event_type).toBe('MilestoneSubmitted')
    expect(outbox?.aggregate_id).toBe(String(loadId))
    expect(Number(outbox?.org_id)).toBe(orgA.orgId)
    expect(outbox?.status).toBe('pending')
    expect((outbox?.payload as { priorStatus: string }).priorStatus).toBe('dispatched')

    const { data: audit } = await admin
      .from('audit_events')
      .select('action, prior_state, new_state, reason, actor_user_id')
      .eq('aggregate_id', String(loadId))
      .single()
    expect(audit?.action).toBe('shipment.milestone.submitted')
    expect(audit?.prior_state).toBe('dispatched')
    expect(audit?.new_state).toBe('picked_up')
    expect(audit?.actor_user_id).toBe(dispatcherA.userId)
  })

  it('rolls back every write when a precondition fails', async () => {
    const id = await createLoad(orgA.orgId, 'dispatched')
    // Wrong expected status -> conflict. Nothing at all should be written.
    const { error } = await call(clientA, {
      loadId: id,
      expected: 'in_transit',
      next: 'delivered',
      idempotencyKey: `rollback-${id}`,
    })
    expect(error).not.toBeNull()

    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('dispatched') // unchanged

    const { count: eventCount } = await admin
      .from('load_events')
      .select('*', { count: 'exact', head: true })
      .eq('load_id', id)
    expect(eventCount).toBe(0)

    const { count: outboxCount } = await admin
      .from('outbox_events')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', `rollback-${id}`)
    expect(outboxCount).toBe(0)
  })
})

describe('optimistic concurrency (compare-and-swap on status)', () => {
  it('rejects a second transition from a now-stale expected status', async () => {
    const id = await createLoad(orgA.orgId, 'dispatched')

    const first = await call(clientA, {
      loadId: id,
      expected: 'dispatched',
      next: 'picked_up',
      idempotencyKey: `cas-1-${id}`,
    })
    expect(first.error).toBeNull()

    // A second dispatcher who read the load before the first write lands.
    const second = await call(clientA, {
      loadId: id,
      expected: 'dispatched',
      next: 'in_transit',
      idempotencyKey: `cas-2-${id}`,
    })
    expect(second.error).not.toBeNull()
    expect(second.error!.message).toContain('VERSION_CONFLICT')
    // The error carries the ACTUAL current status so the client can re-render
    // without a second round trip.
    expect(second.error!.message).toContain('picked_up')
  })

  it('allows the retry once the caller re-reads the current status', async () => {
    const id = await createLoad(orgA.orgId, 'dispatched')
    await call(clientA, { loadId: id, expected: 'dispatched', next: 'picked_up', idempotencyKey: `r1-${id}` })
    const retry = await call(clientA, {
      loadId: id,
      expected: 'picked_up',
      next: 'in_transit',
      idempotencyKey: `r2-${id}`,
    })
    expect(retry.error).toBeNull()
    expect((retry.data as unknown as { status: string }).status).toBe('in_transit')
  })
})

describe('idempotency', () => {
  it('replaying the same key does not duplicate any effect', async () => {
    const id = await createLoad(orgA.orgId, 'dispatched')
    const key = `idem-${id}`

    const first = await call(clientA, { loadId: id, expected: 'dispatched', next: 'picked_up', idempotencyKey: key })
    expect((first.data as unknown as { outcome: string }).outcome).toBe('APPLIED')

    // Same key again — the mobile retry case.
    const replay = await call(clientA, { loadId: id, expected: 'dispatched', next: 'picked_up', idempotencyKey: key })
    expect(replay.error).toBeNull()
    expect((replay.data as unknown as { outcome: string }).outcome).toBe('REPLAYED')

    // Exactly one of each, not two.
    const { count: events } = await admin
      .from('load_events').select('*', { count: 'exact', head: true }).eq('load_id', id)
    expect(events).toBe(1)

    const { count: outbox } = await admin
      .from('outbox_events').select('*', { count: 'exact', head: true }).eq('idempotency_key', key)
    expect(outbox).toBe(1)
  })
})

describe('tenant isolation under SECURITY DEFINER', () => {
  // The function runs as owner and therefore bypasses RLS. These assertions
  // are what prove the explicit my_org_id() check inside it actually replaces
  // that lost layer — without them, DEFINER would be a cross-tenant hole.
  it("refuses to advance another carrier's shipment", async () => {
    const id = await createLoad(orgA.orgId, 'dispatched')

    const { error } = await call(clientB, {
      loadId: id,
      expected: 'dispatched',
      next: 'picked_up',
      idempotencyKey: `cross-${id}`,
    })
    expect(error).not.toBeNull()
    // NOT_FOUND, not FORBIDDEN — confirming a load exists but belongs to
    // someone else is itself a cross-tenant disclosure.
    expect(error!.message).toContain('NOT_FOUND')

    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('dispatched')
  })

  it('writes the outbox event scoped to the acting org, not the payload', async () => {
    const id = await createLoad(orgB.orgId, 'dispatched')
    const key = `scope-${id}`
    await call(clientB, { loadId: id, expected: 'dispatched', next: 'picked_up', idempotencyKey: key })

    const { data: outbox } = await admin
      .from('outbox_events').select('org_id').eq('idempotency_key', key).single()
    expect(Number(outbox?.org_id)).toBe(orgB.orgId)
  })
})
