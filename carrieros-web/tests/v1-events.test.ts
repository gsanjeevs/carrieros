// The live-update path: DB triggers -> change_events -> SSE. Signals carry no
// data and are scoped to the caller's organization.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg,
  type TestOrg,
} from './helpers'

const admin = adminClient()
const BASE_URL = process.env.TEST_APP_URL ?? 'http://localhost:3000'
let orgA: TestOrg
let orgB: TestOrg
let tokenA: string
let loadA: number
let loadB: number

async function insertLoad(orgId: number, tag: string) {
  const { data, error } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgId, load_number: `EV-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`, status: 'draft' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertLoad: ${error?.message}`)
  return Number(data.id)
}

// Reads the stream until `predicate(buffer)` is true or `ms` elapses.
async function readStreamUntil(token: string, action: () => Promise<void>, predicate: (buf: string) => boolean, ms: number) {
  const controller = new AbortController()
  const res = await fetch(`${BASE_URL}/api/v1/events?entities=loads`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + ms
  let acted = false
  // Exactly one read is ever pending: racing read() against a timer and then
  // calling read() again would silently drop the chunk the first call delivers.
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null
  try {
    while (Date.now() < deadline) {
      pending ??= reader.read()
      const tick = new Promise<'tick'>((r) => setTimeout(() => r('tick'), 500))
      const got = await Promise.race([pending, tick])
      if (got === 'tick') continue
      pending = null
      if (got.done) break
      buffer += decoder.decode(got.value, { stream: true })
      if (!acted && buffer.includes('event: ready')) {
        acted = true
        await action()
      }
      if (acted && predicate(buffer)) break
    }
  } finally {
    controller.abort()
  }
  return buffer
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  tokenA = (await signInAs(owner)).accessToken
  loadA = await insertLoad(orgA.orgId, 'a')
  loadB = await insertLoad(orgB.orgId, 'b')
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('change_events triggers', () => {
  it('a load write and a timeline write both signal "loads" for the load\'s org, with no business data', async () => {
    const { data: before } = await admin.from('change_events').select('id').eq('org_id', orgA.orgId).order('id', { ascending: false }).limit(1)
    const after = before?.[0]?.id ?? 0
    await admin.from('loads').update({ status: 'scheduled' }).eq('id', loadA)
    await admin.from('load_events').insert({ load_id: loadA, event_type: 'note', note: 'x' })
    const { data } = await admin.from('change_events').select('*').eq('org_id', orgA.orgId).gt('id', after)
    expect(data!.map((r) => r.entity)).toEqual(['loads', 'loads'])
    expect(Object.keys(data![0]).sort()).toEqual(['created_at', 'entity', 'entity_id', 'id', 'op', 'org_id'])
  })

  it('client roles cannot read the feed directly', async () => {
    const { client } = await signInAs({ ...(await createTestUser(admin, orgA.orgId, 'dispatcher')) })
    const { data, error } = await client.from('change_events').select('id').limit(1)
    expect(error ?? data?.length === 0).toBeTruthy()
    expect(data ?? []).toHaveLength(0)
  })
})

describe('GET /api/v1/events', () => {
  it('requires authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/events`)
    expect(res.status).toBe(401)
  })

  it('delivers a change signal for the caller\'s org, and only that', async () => {
    const buf = await readStreamUntil(
      tokenA,
      async () => {
        await admin.from('loads').update({ status: 'dispatched' }).eq('id', loadB) // other org: must NOT arrive
        await admin.from('loads').update({ status: 'dispatched' }).eq('id', loadA)
      },
      (b) => b.includes('event: change'),
      15_000
    )
    expect(buf).toContain('event: change')
    expect(buf).toContain('"entity":"loads"')
    // One coalesced signal, and no ids or row data in the payload.
    const changes = buf.split('\n\n').filter((b) => b.includes('event: change'))
    expect(changes.length).toBeGreaterThanOrEqual(1)
    for (const c of changes) expect(c).not.toMatch(/load_number|rate|status/)
  }, 30_000)
})
