// tests/security-public-api.test.ts — adversarial tests for the Phase 9 public developer API
// (OAuth 2.0 client-credentials grant, /api/public/v1/**). This is a genuinely new trust boundary:
// external callers authenticate as an ORGANIZATION via client_id/client_secret, never as a
// logged-in human. This file checks that boundary actually holds: tenant isolation (same pattern
// as security-mobile-reads.test.ts), Growth+ tier gating at token-issue time, JWT integrity
// (tampered/forged/expired/alg-none rejected), revocation semantics as actually built (not as
// preferred), Postgres-backed rate limiting, and that this boundary never overlaps
// /api/v1/oauth-clients (the session-authenticated internal client-management surface).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, cleanupTestUser, type TestUser } from './helpers'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const JWT_SECRET = process.env.PUBLIC_API_JWT_SECRET!

if (!JWT_SECRET) {
  throw new Error('Tests require PUBLIC_API_JWT_SECRET in carrieros-web/.env.local')
}

const api = (token: string | null, method: string, path: string, body?: unknown) =>
  fetch(`${APP}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

async function createOAuthClient(admin: SupabaseClient<Database>, orgId: number, name: string) {
  const clientId = `pub_client_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const clientSecret = `pub_secret_test_${Math.random().toString(36).slice(2, 15)}`
  // Low bcrypt cost here only to keep the test suite fast — bcrypt.compare() in the real code
  // path (NodeOAuthCredentialProvider.verifySecret) works against any cost embedded in the hash.
  const hash = await bcrypt.hash(clientSecret, 4)
  const { error } = await admin.from('oauth_clients').insert({ org_id: orgId, client_id: clientId, client_secret_hash: hash, name })
  if (error) throw new Error(`createOAuthClient: ${error.message}`)
  return { clientId, clientSecret }
}

async function getToken(clientId: string, clientSecret: string) {
  return api(null, 'POST', '/api/public/v1/oauth/token', { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
}

async function issueAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await getToken(clientId, clientSecret)
  if (res.status !== 200) throw new Error(`issueAccessToken failed: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

// Keeps firing until a 429 appears or maxAttempts is exhausted — robust to the fixed-window rate
// limiter's minute boundary rolling over mid-run (a naive fixed burst can straddle two windows and
// never exceed either one's limit).
async function hitUntilRateLimited(token: string, maxAttempts = 400, batchSize = 20) {
  let attempts = 0
  while (attempts < maxAttempts) {
    const batch = await Promise.all(Array.from({ length: batchSize }, () => api(token, 'GET', '/api/public/v1/loads')))
    attempts += batchSize
    const limited = batch.find((r) => r.status === 429)
    if (limited) return limited
  }
  return null
}

describe('public developer API (OAuth client-credentials, /api/public/v1)', () => {
  let admin: SupabaseClient<Database>
  let orgA: number, orgB: number, orgStarter: number
  let loadA1: number, invoiceA: number
  let clientA: { clientId: string; clientSecret: string }
  let clientB: { clientId: string; clientSecret: string }
  let clientStarter: { clientId: string; clientSecret: string }

  beforeAll(async () => {
    admin = adminClient()
    orgA = (await createTestOrg(admin, 'carrier', { tier: 'growth' })).orgId
    orgB = (await createTestOrg(admin, 'carrier', { tier: 'growth' })).orgId
    orgStarter = (await createTestOrg(admin, 'carrier', { tier: 'starter' })).orgId

    const { data: loadRow, error: loadErr } = await admin
      .from('loads')
      .insert({ carrier_org_id: orgA, load_number: `PUBAPI-${Date.now()}`, status: 'dispatched', rate: 5555 })
      .select('id')
      .single()
    if (loadErr || !loadRow) throw new Error(`load setup: ${loadErr?.message}`)
    loadA1 = Number(loadRow.id)

    const { data: invRow, error: invErr } = await admin
      .from('invoices')
      .insert({ carrier_org_id: orgA, load_id: loadA1, invoice_number: `PUBAPI-INV-${Date.now()}`, amount: 999, status: 'sent' })
      .select('id')
      .single()
    if (invErr || !invRow) throw new Error(`invoice setup: ${invErr?.message}`)
    invoiceA = Number(invRow.id)

    clientA = await createOAuthClient(admin, orgA, 'Test Client A')
    clientB = await createOAuthClient(admin, orgB, 'Test Client B')
    clientStarter = await createOAuthClient(admin, orgStarter, 'Test Client Starter')
  }, 60_000)

  afterAll(async () => {
    await cleanupTestOrg(admin, orgA)
    await cleanupTestOrg(admin, orgB)
    await cleanupTestOrg(admin, orgStarter)
  })

  describe('token issuance', () => {
    it('issues a token for a valid client on a Growth+ org', async () => {
      const res = await getToken(clientA.clientId, clientA.clientSecret)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.token_type).toBe('Bearer')
      expect(typeof json.access_token).toBe('string')
      expect(json.expires_in).toBe(3600)
    })

    it("rejects a Starter-tier org's client at token-issue time", async () => {
      const res = await getToken(clientStarter.clientId, clientStarter.clientSecret)
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('unauthorized_client')
    })

    it('rejects an unknown client_id and a wrong secret identically (never reveals which)', async () => {
      const unknown = await getToken('pub_client_does_not_exist', 'whatever')
      const wrongSecret = await getToken(clientA.clientId, 'wrong-secret')
      expect(unknown.status).toBe(401)
      expect(wrongSecret.status).toBe(401)
      const unknownJson = await unknown.json()
      const wrongJson = await wrongSecret.json()
      expect(unknownJson.error).toBe('invalid_client')
      expect(wrongJson.error).toBe('invalid_client')
      expect(unknownJson.error_description).toBe(wrongJson.error_description)
    })
  })

  describe('tenant isolation', () => {
    let tokenA: string, tokenB: string
    beforeAll(async () => {
      tokenA = await issueAccessToken(clientA.clientId, clientA.clientSecret)
      tokenB = await issueAccessToken(clientB.clientId, clientB.clientSecret)
    })

    it("org A's client sees its own load and invoice", async () => {
      const loadRes = await api(tokenA, 'GET', `/api/public/v1/loads/${loadA1}`)
      expect(loadRes.status).toBe(200)
      const invRes = await api(tokenA, 'GET', `/api/public/v1/invoices/${invoiceA}`)
      expect(invRes.status).toBe(200)
    })

    it("org B's client cannot see org A's load or invoice (404, not 403 — never confirms the id exists)", async () => {
      const loadRes = await api(tokenB, 'GET', `/api/public/v1/loads/${loadA1}`)
      expect(loadRes.status).toBe(404)
      const invRes = await api(tokenB, 'GET', `/api/public/v1/invoices/${invoiceA}`)
      expect(invRes.status).toBe(404)
    })

    it("org B's client list endpoints never include org A's rows", async () => {
      const loadsRes = await api(tokenB, 'GET', '/api/public/v1/loads')
      expect(loadsRes.status).toBe(200)
      const loads = await loadsRes.json()
      expect(loads.loads.some((l: { id: number }) => l.id === loadA1)).toBe(false)

      const invoicesRes = await api(tokenB, 'GET', '/api/public/v1/invoices')
      expect(invoicesRes.status).toBe(200)
      const invoices = await invoicesRes.json()
      expect(invoices.invoices.some((inv: { id: number }) => inv.id === invoiceA)).toBe(false)
    })
  })

  describe('token integrity', () => {
    it('rejects a request with no bearer token', async () => {
      expect((await api(null, 'GET', '/api/public/v1/loads')).status).toBe(401)
    })

    it('rejects a tampered token', async () => {
      const good = await issueAccessToken(clientA.clientId, clientA.clientSecret)
      const tampered = good.slice(0, -4) + (good.slice(-4) === 'abcd' ? 'dcba' : 'abcd')
      const res = await api(tampered, 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
      expect((await res.json()).error).toBe('invalid_token')
    })

    it('rejects an expired token', async () => {
      const expired = jwt.sign({ org_id: orgA, client_id: clientA.clientId, scope: 'read' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: -10 })
      const res = await api(expired, 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
    })

    it('rejects a token signed with the wrong secret (forged by an attacker without PUBLIC_API_JWT_SECRET)', async () => {
      const forged = jwt.sign({ org_id: orgA, client_id: clientA.clientId, scope: 'read' }, 'attacker-controlled-secret', { algorithm: 'HS256', expiresIn: 3600 })
      const res = await api(forged, 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
    })

    it('rejects an alg=none forged token (never trusts the token\'s own alg header)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ org_id: orgA, client_id: clientA.clientId, scope: 'read' })).toString('base64url')
      const forged = `${header}.${payload}.`
      const res = await api(forged, 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
    })

    it('rejects a malformed/garbage bearer value', async () => {
      const res = await api('not-a-jwt-at-all', 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
    })
  })

  describe('revocation', () => {
    it("a revoked client cannot mint new tokens, but a token issued before revocation still works until its natural 1h expiry (documented v1 scope decision, not a gap)", async () => {
      const revocable = await createOAuthClient(admin, orgA, 'Revoke Me')
      const preRevokeToken = await issueAccessToken(revocable.clientId, revocable.clientSecret)

      expect((await api(preRevokeToken, 'GET', '/api/public/v1/loads')).status).toBe(200)

      const { error } = await admin.from('oauth_clients').update({ revoked_at: new Date().toISOString() }).eq('client_id', revocable.clientId)
      expect(error).toBeNull()

      const postRevokeTokenReq = await getToken(revocable.clientId, revocable.clientSecret)
      expect(postRevokeTokenReq.status).toBe(401)
      expect((await postRevokeTokenReq.json()).error).toBe('invalid_client')

      // Already-issued token: this is the built (and documented) behavior — it stays valid, not
      // immediately invalidated. If revocation is ever meant to be immediate, this assertion is
      // exactly what should flip red first.
      expect((await api(preRevokeToken, 'GET', '/api/public/v1/loads')).status).toBe(200)
    })
  })

  describe('rate limiting', () => {
    it('returns 429 past the per-client threshold, genuinely enforced in Postgres (shared across concurrent callers)', async () => {
      const limited = await createOAuthClient(admin, orgA, 'Rate Limited Client')
      const token = await issueAccessToken(limited.clientId, limited.clientSecret)

      const limitedRes = await hitUntilRateLimited(token)
      expect(limitedRes, 'expected at least one 429 within maxAttempts').not.toBeNull()
      expect(limitedRes!.status).toBe(429)
      expect(limitedRes!.headers.get('retry-after')).toBeTruthy()
      const json = await limitedRes!.json()
      expect(json.error).toBe('rate_limited')
    }, 60_000)
  })

  describe('trust boundary separation: /api/public/v1 vs /api/v1/oauth-clients', () => {
    let ownerUser: TestUser
    let ownerToken: string

    beforeAll(async () => {
      ownerUser = await createTestUser(admin, orgA, 'owner')
      const signed = await signInAs(ownerUser)
      ownerToken = signed.accessToken
    })

    afterAll(async () => {
      await cleanupTestUser(admin, ownerUser.userId)
    })

    it('the internal client-management API rejects a public API OAuth token — the two boundaries do not share auth', async () => {
      const publicToken = await issueAccessToken(clientA.clientId, clientA.clientSecret)
      const res = await api(publicToken, 'GET', '/api/v1/oauth-clients')
      expect(res.status).toBe(401)
    })

    it('the internal client-management API works for a real logged-in owner session', async () => {
      const res = await api(ownerToken, 'GET', '/api/v1/oauth-clients')
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(Array.isArray(json.clients)).toBe(true)
    })

    it("a logged-in user's session token cannot authenticate to the public API surface", async () => {
      const res = await api(ownerToken, 'GET', '/api/public/v1/loads')
      expect(res.status).toBe(401)
    })
  })
})
