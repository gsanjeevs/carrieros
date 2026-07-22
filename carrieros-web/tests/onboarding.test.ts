// tests/onboarding.test.ts
// Gate 0→1 — the onboarding route creates organizations + carrier_details +
// profiles atomically (app/api/onboarding/route.ts). Hits the real running
// dev server (not a mock) via Bearer token, same auth path carrieros-mobile
// uses (lib/api-auth.ts's getAuthedContext()).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, apiFetch, cleanupTestOrg, cleanupTestUser } from './helpers'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const admin = adminClient()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let bareUserId: string
let accessToken: string
let createdOrgId: number | undefined

const email = `onboarding_test_${Date.now()}@carrieros-test.dev`
const password = 'OnboardTest123!'

beforeAll(async () => {
  // A bare auth user with NO profiles row at all — the exact state
  // onboarding is meant to handle (a brand-new signup).
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error || !created.user) throw new Error(`setup: ${error?.message}`)
  bareUserId = created.user.id

  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY)
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password })
  if (signInErr || !signIn.session) throw new Error(`sign-in: ${signInErr?.message}`)
  accessToken = signIn.session.access_token
})

afterAll(async () => {
  if (createdOrgId) await cleanupTestOrg(admin, createdOrgId)
  else await cleanupTestUser(admin, bareUserId)
})

describe('POST /api/onboarding', () => {
  it('creates organizations + carrier_details + profiles atomically for a new user', async () => {
    const res = await apiFetch('/api/onboarding', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        company_name: 'Test Onboarding Co',
        state: 'CA',
        country: 'US',
        first_name: 'Test',
        last_name: 'Owner',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.org_id).toBeTypeOf('number')
    createdOrgId = body.org_id
    const orgId: number = createdOrgId!

    const { data: profile } = await admin.from('profiles').select('org_id, role').eq('id', bareUserId).single()
    expect(profile?.org_id).toBe(orgId)
    expect(profile?.role).toBe('owner')

    const { data: details } = await admin.from('carrier_details').select('tier').eq('org_id', orgId).single()
    expect(details?.tier).toBe('starter')
  })

  it('rejects a second onboarding attempt for an already-onboarded user', async () => {
    const res = await apiFetch('/api/onboarding', accessToken, {
      method: 'POST',
      body: JSON.stringify({ company_name: 'Second Attempt Co', state: 'TX', first_name: 'A', last_name: 'B' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error_code).toBe('ALREADY_ONBOARDED')
  })
})
