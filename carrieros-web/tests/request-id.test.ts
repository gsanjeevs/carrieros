// Every response carries an x-request-id (proxy.ts) so a user-reported failure
// can be matched to a log line / tracker event. Uses the running app like the
// other API tests (TEST_APP_URL, default http://localhost:3000).
import { describe, it, expect } from 'vitest'

const BASE_URL = process.env.TEST_APP_URL ?? 'http://localhost:3000'

describe('x-request-id', () => {
  it('is generated for API responses when the caller sends none', async () => {
    const res = await fetch(`${BASE_URL}/api/loads`, { method: 'POST' })
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('echoes an id supplied by an upstream proxy', async () => {
    const res = await fetch(`${BASE_URL}/api/loads`, {
      method: 'POST',
      headers: { 'x-request-id': 'upstream-abc' },
    })
    expect(res.headers.get('x-request-id')).toBe('upstream-abc')
  })

  it('is set on page responses too', async () => {
    const res = await fetch(`${BASE_URL}/login`)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('unauthenticated API calls return the typed error contract', async () => {
    const res = await fetch(`${BASE_URL}/api/loads`, { method: 'POST' })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error_code).toBe('AUTH_REQUIRED')
    expect(typeof body.error).toBe('string')
  })
})
