// PATCH /api/v1/me/preferences and PUT /api/v1/me/push-token: a user writes only
// to their own profile, and only values from the closed sets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let org: TestOrg
let aliceId: string
let bobId: string
let aliceToken: string

const send = async (method: string, path: string, body: unknown, token = aliceToken) => {
  const res = await apiFetch(path, token, { method, body: JSON.stringify(body) })
  return { res, json: await res.json() }
}
const profile = async (id: string) =>
  (await admin.from('profiles').select('preferred_language, uom_system, date_format, time_format, theme_preference, push_token').eq('id', id).single()).data!

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier')
  const alice = await createTestUser(admin, org.orgId, 'dispatcher')
  const bob = await createTestUser(admin, org.orgId, 'dispatcher')
  aliceId = alice.userId
  bobId = bob.userId
  aliceToken = (await signInAs(alice)).accessToken
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

describe('PATCH /api/v1/me/preferences', () => {
  it('updates the caller\'s own preferences, including clearing uom to inherit', async () => {
    const { res, json } = await send('PATCH', '/api/v1/me/preferences', {
      preferred_language: 'es', uom_system: 'metric', date_format: 'DD/MM/YYYY', time_format: '24h', theme_preference: 'dark',
    })
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(await profile(aliceId)).toMatchObject({
      preferred_language: 'es', uom_system: 'metric', date_format: 'DD/MM/YYYY', time_format: '24h', theme_preference: 'dark',
    })

    await send('PATCH', '/api/v1/me/preferences', { uom_system: null })
    expect((await profile(aliceId)).uom_system).toBeNull()
  })

  it('cannot be aimed at another user: an id in the body is ignored, the other profile is untouched', async () => {
    const before = await profile(bobId)
    const { res } = await send('PATCH', '/api/v1/me/preferences', { id: bobId, theme_preference: 'light' })
    expect(res.status).toBe(200)
    expect(await profile(bobId)).toEqual(before)
    expect((await profile(aliceId)).theme_preference).toBe('light')
  })

  it('rejects out-of-range values with 400 and an empty body with 400', async () => {
    const bad = await send('PATCH', '/api/v1/me/preferences', { preferred_language: 'fr' })
    expect(bad.res.status).toBe(400)
    expect(bad.json.error_code).toBe('VALIDATION_ERROR')
    expect((await send('PATCH', '/api/v1/me/preferences', {})).res.status).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/me/preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"theme_preference":"dark"}',
    })
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/v1/me/push-token', () => {
  it('stores the token on the caller\'s own profile only', async () => {
    const { res } = await send('PUT', '/api/v1/me/push-token', { token: 'ExponentPushToken[abc123]' })
    expect(res.status).toBe(200)
    expect((await profile(aliceId)).push_token).toBe('ExponentPushToken[abc123]')
    expect((await profile(bobId)).push_token).toBeNull()
  })

  it('rejects an empty token', async () => {
    expect((await send('PUT', '/api/v1/me/push-token', { token: '' })).res.status).toBe(400)
  })
})
