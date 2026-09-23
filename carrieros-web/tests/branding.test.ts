// tests/branding.test.ts
// Enterprise branding customization (decisions.md PR1 amendment) —
// POST /api/settings/branding: role gating (org_branding_manage,
// owner/solo only), tier gating (has_feature('branding_customization'),
// Enterprise only), color validation, and that a logo upload actually
// persists organizations.logo_path via Supabase Storage. Mirrors
// tests/billing.test.ts's shape (a role-and-tier-gated org-admin route,
// same TIER_UPGRADE_REQUIRED/FORBIDDEN error codes) and
// tests/settlements.test.ts's tier-flip-via-admin-client setup.
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

// A minimal (1x1 transparent pixel) real PNG — small enough to keep the test
// fast, but real image bytes so the route's upload path (StorageProvider ->
// Supabase Storage) is exercised for real, not a stub.
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
)

function logoFile(name = 'logo.png') {
  return new File([PNG_BYTES], name, { type: 'image/png' })
}

beforeAll(async () => {
  // Starts at 'starter' deliberately — the TIER_UPGRADE_REQUIRED tests below
  // need a non-Enterprise org, and the success-path tests flip it up via the
  // admin client afterward (same technique tests/billing.test.ts's own
  // change-tier assertions use).
  org = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  owner = await createTestUser(admin, org.orgId, 'owner')
  dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
  ownerSession = await signInAs(owner)
  dispatcherSession = await signInAs(dispatcher)
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

describe('POST /api/settings/branding', () => {
  it('rejects a dispatcher (org_branding_manage is owner/solo only)', async () => {
    const form = new FormData()
    form.set('primary_color', '#112233')
    const res = await apiFetch('/api/settings/branding', dispatcherSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error_code).toBe('FORBIDDEN')
  })

  it('rejects the owner on a non-Enterprise org (TIER_UPGRADE_REQUIRED)', async () => {
    const form = new FormData()
    form.set('primary_color', '#112233')
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error_code).toBe('TIER_UPGRADE_REQUIRED')
  })

  it('rejects a request with nothing to update', async () => {
    await admin.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', org.orgId)

    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: new FormData(),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('rejects an invalid color value', async () => {
    const form = new FormData()
    form.set('primary_color', 'not-a-color')
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('allows the Enterprise owner to set both brand colors, and it persists', async () => {
    const form = new FormData()
    form.set('primary_color', '#112233')
    form.set('accent_color', '#445566')
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.primary_color).toBe('#112233')
    expect(json.accent_color).toBe('#445566')

    const { data } = await admin
      .from('carrier_details')
      .select('brand_primary_color, brand_accent_color')
      .eq('org_id', org.orgId)
      .single()
    expect(data?.brand_primary_color).toBe('#112233')
    expect(data?.brand_accent_color).toBe('#445566')
  })

  it('clears a color override with a blank value', async () => {
    const form = new FormData()
    form.set('primary_color', '')
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.primary_color).toBeNull()

    const { data } = await admin
      .from('carrier_details')
      .select('brand_primary_color, brand_accent_color')
      .eq('org_id', org.orgId)
      .single()
    expect(data?.brand_primary_color).toBeNull()
    // Untouched field (not submitted this call) keeps its prior value.
    expect(data?.brand_accent_color).toBe('#445566')
  })

  it('uploads a logo and persists organizations.logo_path', async () => {
    const form = new FormData()
    form.set('logo', logoFile())
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.logo_updated).toBe(true)
    expect(json.logo_path).toMatch(new RegExp(`^${org.orgId}/logo/`))

    const { data } = await admin.from('organizations').select('logo_path').eq('id', org.orgId).single()
    expect(data?.logo_path).toBe(json.logo_path)
  })

  it('rejects an oversized/unsupported file type before uploading', async () => {
    const form = new FormData()
    form.set('logo', new File([PNG_BYTES], 'logo.txt', { type: 'text/plain' }))
    const res = await apiFetch('/api/settings/branding', ownerSession.accessToken, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })
})
