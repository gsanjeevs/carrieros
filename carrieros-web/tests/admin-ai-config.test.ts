// tests/admin-ai-config.test.ts — the LLM Provider admin screen (app/(admin)/admin/ai-config):
// GET/PUT /api/admin/ai-config (platform-wide default) and GET/PUT/DELETE
// /api/admin/ai-config/features/[feature] (per-feature override, e.g. 'translation'). Both gated on
// the admin_ai_config capability, sx_owner only (migration 0031/0036) -- sx_finance/sx_support and
// non-admin users must get 403. No test existed for either route before this file, even though both
// have been live since migration 0031/0036 and now have a UI (FeatureOverrideCard.tsx) built on top.
//
// Deliberately never sends a provider API key field in any request body here: ai_provider_config is
// a real, live singleton row this local dev database already has meaningfully configured (not test
// fixture data), so this file only ever touches provider/model/compatible_base_url -- restored to
// their exact pre-test values in afterAll -- and never risks clobbering a real encrypted key this
// suite has no way to restore (the plaintext is never readable back).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg } from './helpers'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const admin = adminClient()
let platformOrg: number, carrier: number
let sxOwner: string, sxFinance: string, sxSupport: string, carrierOwnerToken: string

let originalConfig: { provider: string; model: string; compatible_base_url: string | null }

const getConfig = (token: string) =>
  fetch(`${APP}/api/admin/ai-config`, { headers: { Authorization: `Bearer ${token}` } })

const putConfig = (token: string, body: unknown) =>
  fetch(`${APP}/api/admin/ai-config`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const getFeature = (token: string, feature: string) =>
  fetch(`${APP}/api/admin/ai-config/features/${feature}`, { headers: { Authorization: `Bearer ${token}` } })

const putFeature = (token: string, feature: string, body: unknown) =>
  fetch(`${APP}/api/admin/ai-config/features/${feature}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const deleteFeature = (token: string, feature: string) =>
  fetch(`${APP}/api/admin/ai-config/features/${feature}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  const { data } = await admin.from('ai_provider_config').select('provider, model, compatible_base_url').eq('id', 1).single()
  originalConfig = data!

  platformOrg = (await createTestOrg(admin, 'carrier')).orgId
  await admin.from('organizations').update({ type: 'platform' }).eq('id', platformOrg)
  carrier = (await createTestOrg(admin, 'carrier')).orgId
  sxOwner = (await signInAs(await createTestUser(admin, platformOrg, 'sx_owner'))).accessToken
  sxFinance = (await signInAs(await createTestUser(admin, platformOrg, 'sx_finance'))).accessToken
  sxSupport = (await signInAs(await createTestUser(admin, platformOrg, 'sx_support'))).accessToken
  carrierOwnerToken = (await signInAs(await createTestUser(admin, carrier, 'owner'))).accessToken
}, 60_000)

afterAll(async () => {
  // Restore the real singleton row exactly -- never a test fixture, this local DB's actual
  // configured provider/model.
  await admin.from('ai_provider_config').update(originalConfig).eq('id', 1)
  await admin.from('ai_feature_overrides').delete().eq('feature', 'translation')
  await cleanupTestOrg(admin, carrier)
  await cleanupTestOrg(admin, platformOrg)
}, 30_000)

describe('GET/PUT /api/admin/ai-config (platform-wide default)', () => {
  it('sx_owner sees the current config, with a masked key preview only', async () => {
    const res = await getConfig(sxOwner)
    expect(res.status).toBe(200)
    const { config } = await res.json()
    expect(config.provider).toBe(originalConfig.provider)
    expect(config.model).toBe(originalConfig.model)
    expect(config).not.toHaveProperty('anthropic_api_key_encrypted')
    expect(config).not.toHaveProperty('openai_api_key_encrypted')
  })

  it('sx_finance and sx_support get 403 (admin_ai_config is sx_owner only)', async () => {
    expect((await getConfig(sxFinance)).status).toBe(403)
    expect((await getConfig(sxSupport)).status).toBe(403)
  })

  it('a carrier owner (not ShipmentX staff at all) gets 403', async () => {
    expect((await getConfig(carrierOwnerToken)).status).toBe(403)
  })

  it('sx_owner can change the platform-wide provider and model, and it persists', async () => {
    const res = await putConfig(sxOwner, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(res.status).toBe(200)
    const { config } = await res.json()
    expect(config.provider).toBe('anthropic')
    expect(config.model).toBe('claude-haiku-4-5')

    const reread = await getConfig(sxOwner)
    const { config: rereadConfig } = await reread.json()
    expect(rereadConfig.provider).toBe('anthropic')
    expect(rereadConfig.model).toBe('claude-haiku-4-5')

    // Restore immediately rather than waiting for afterAll, so later tests in this file see the
    // real original config, not this test's temporary value.
    await putConfig(sxOwner, originalConfig)
  })

  it('rejects an unknown provider and a missing model', async () => {
    expect((await putConfig(sxOwner, { provider: 'not_a_real_provider', model: 'x' })).status).toBe(400)
    expect((await putConfig(sxOwner, { provider: 'openai', model: '' })).status).toBe(400)
  })

  it('sx_finance cannot change the config', async () => {
    const res = await putConfig(sxFinance, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(res.status).toBe(403)
    // Confirm the rejected write really didn't land.
    const { config } = await (await getConfig(sxOwner)).json()
    expect(config.provider).toBe(originalConfig.provider)
  })
})

describe('GET/PUT/DELETE /api/admin/ai-config/features/[feature] (per-feature override)', () => {
  it('with no override row, GET returns { override: null } (falls back to the platform default)', async () => {
    const res = await getFeature(sxOwner, 'translation')
    expect(res.status).toBe(200)
    const { override } = await res.json()
    expect(override).toBeNull()
  })

  it('rejects a feature name outside AI_FEATURES', async () => {
    expect((await getFeature(sxOwner, 'not_a_real_feature')).status).toBe(400)
    expect((await putFeature(sxOwner, 'not_a_real_feature', { provider: 'openai', model: 'gpt-5-mini' })).status).toBe(400)
  })

  it('sx_owner can create a per-feature override, it round-trips, and revert removes it', async () => {
    const put = await putFeature(sxOwner, 'translation', { provider: 'openai', model: 'gpt-5-mini' })
    expect(put.status).toBe(200)
    const { override: putOverride } = await put.json()
    expect(putOverride.feature).toBe('translation')
    expect(putOverride.provider).toBe('openai')
    expect(putOverride.model).toBe('gpt-5-mini')

    const reread = await getFeature(sxOwner, 'translation')
    const { override: rereadOverride } = await reread.json()
    expect(rereadOverride.model).toBe('gpt-5-mini')

    // PUT again with a different model -- full replace, not a merge, per the route's own contract.
    const secondPut = await putFeature(sxOwner, 'translation', { provider: 'anthropic', model: 'claude-haiku-4-5' })
    const { override: secondOverride } = await secondPut.json()
    expect(secondOverride.provider).toBe('anthropic')
    expect(secondOverride.model).toBe('claude-haiku-4-5')

    const del = await deleteFeature(sxOwner, 'translation')
    expect(del.status).toBe(200)
    const { override: afterDelete } = await (await getFeature(sxOwner, 'translation')).json()
    expect(afterDelete).toBeNull()
  })

  it('sx_finance and sx_support cannot read or write a feature override; a carrier owner gets 403 too', async () => {
    expect((await getFeature(sxFinance, 'translation')).status).toBe(403)
    expect((await putFeature(sxSupport, 'translation', { provider: 'openai', model: 'gpt-5-mini' })).status).toBe(403)
    expect((await getFeature(carrierOwnerToken, 'translation')).status).toBe(403)
  })
})
