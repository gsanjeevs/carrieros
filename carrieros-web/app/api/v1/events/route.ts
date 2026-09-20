// GET /api/v1/events — server-sent change signals for the caller's organization.
//
// Transport only. Auth works for both clients (cookie for web, Bearer for
// mobile). The stream carries entity-level "something changed" signals and no
// data (see change-feed-service.ts): the client refetches through the API.
//
// Long-lived by nature, so the stream is capped (STREAM_MS) and the client
// reconnects with Last-Event-ID; nothing is lost across the seam because signals
// are read from a cursor over change_events, not from in-memory state.
import { NextRequest } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createChangeFeedService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CHANGE_ENTITIES, isChangeEntity, type ChangeEntity } from '@/server/domain/events/entities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const POLL_MS = Number(process.env.EVENTS_POLL_MS ?? 2000)
const STREAM_MS = Number(process.env.EVENTS_STREAM_MS ?? 270_000)
const KEEPALIVE_MS = 15_000

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actorResult = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actorResult.ok) return domainErrorResponse(actorResult.error)
  const actor = actorResult.value

  const raw = request.nextUrl.searchParams.get('entities')
  const wanted: ChangeEntity[] = raw
    ? raw.split(',').filter(isChangeEntity)
    : [...CHANGE_ENTITIES]

  const feed = createChangeFeedService()

  const resumeFrom = request.headers.get('last-event-id') ?? request.nextUrl.searchParams.get('since')
  let cursor = resumeFrom !== null && /^\d+$/.test(resumeFrom) ? Number(resumeFrom) : null
  if (cursor === null) {
    const latest = await feed.currentCursor(actor)
    if (!latest.ok) return domainErrorResponse(latest.error)
    cursor = latest.value
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk))
      const deadline = Date.now() + STREAM_MS
      let lastWrite = Date.now()

      write('retry: 3000\n\n')
      write(`event: ready\nid: ${cursor}\ndata: {}\n\n`)
      void feed.prune().catch(() => {})

      try {
        while (!request.signal.aborted && Date.now() < deadline) {
          const polled = await feed.poll(actor, cursor!, wanted)
          if (!polled.ok) {
            logError({ route: 'api/v1/events GET', requestId, userId: authed.user.id }, polled.error.detail)
            break
          }
          cursor = polled.value.cursor
          if (polled.value.entities.length > 0) {
            for (const entity of polled.value.entities) {
              write(`event: change\nid: ${cursor}\ndata: ${JSON.stringify({ entity })}\n\n`)
            }
            lastWrite = Date.now()
          } else if (Date.now() - lastWrite > KEEPALIVE_MS) {
            write(': keepalive\n\n')
            lastWrite = Date.now()
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        }
      } finally {
        try { controller.close() } catch { /* already closed by the client */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
