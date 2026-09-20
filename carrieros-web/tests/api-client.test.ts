// The generated client is byte-identical in both apps (npm run check:api), so
// testing it once here covers web and mobile. Uses a fake streaming fetch.
import { describe, it, expect } from 'vitest'
import { createApiClient, type ChangeSignal } from '@/lib/generated/api-client'

const enc = new TextEncoder()

function sseResponse(chunks: string[], status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
  expect(cond()).toBe(true)
}

describe('createApiClient.subscribe', () => {
  it('parses events split across chunks, filters entities, sends the Bearer token, ignores keepalives', async () => {
    const seen: ChangeSignal[] = []
    const requests: { url: string; headers: Record<string, string> }[] = []
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 'tok-1',
      streamFetch: (async (url: string, init: RequestInit) => {
        requests.push({ url, headers: init.headers as Record<string, string> })
        if (requests.length === 1) {
          return sseResponse([
            'retry: 3000\n\nevent: ready\nid: 5\ndata: {}\n\n: keepal',
            'ive\n\nevent: change\nid: 6\ndata: {"enti',
            'ty":"loads"}\n\nevent: change\nid: 7\ndata: {"entity":"invoices"}\n\n',
          ])
        }
        return new Promise<Response>(() => {}) // hold the second connection open
      }) as unknown as typeof fetch,
    })

    const stop = client.subscribe(['loads'], (s) => seen.push(s))
    await until(() => seen.length >= 1 && requests.length >= 2)
    stop()

    expect(seen).toEqual(['loads']) // invoices was not subscribed; keepalive ignored
    expect(requests[0].url).toBe('https://api.test/api/v1/events?entities=loads')
    expect(requests[0].headers.Authorization).toBe('Bearer tok-1')
    // Reconnect resumes from the last id the server sent.
    expect(requests[1].headers['Last-Event-ID']).toBe('7')
  })

  it('emits "resync" after a reconnect so the UI refetches whatever it missed', async () => {
    const seen: ChangeSignal[] = []
    let calls = 0
    const client = createApiClient({
      baseUrl: '',
      streamFetch: (async () => {
        calls++
        if (calls <= 2) return sseResponse(['event: ready\nid: 1\ndata: {}\n\n'])
        return new Promise<Response>(() => {})
      }) as unknown as typeof fetch,
    })
    const stop = client.subscribe(['loads'], (s) => seen.push(s))
    await until(() => calls >= 3)
    stop()
    expect(seen).toContain('resync')
  })

  it('stops and reports when the server rejects the token', async () => {
    let unauthorized = 0
    const statuses: string[] = []
    const client = createApiClient({
      baseUrl: '',
      onUnauthorized: () => unauthorized++,
      streamFetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    })
    client.subscribe(['loads'], () => {}, { onStatus: (s) => statuses.push(s) })
    await until(() => statuses.includes('stopped'))
    expect(unauthorized).toBe(1)
  })
})
