import { NextRequest, NextResponse } from 'next/server'
import { createDriverMessageService } from '@/server/composition'
import { SendDriverMessageBodySchema, SendDriverMessageResponseSchema } from '@/server/contract/schemas'
import { domainErrorResponse } from '@/server/http-errors'
import { isHttpResponse, parseResourceRequest } from '@/server/http-resource'

export async function POST(request: NextRequest) {
  const cmd = await parseResourceRequest(request, SendDriverMessageBodySchema)
  if (isHttpResponse(cmd)) return cmd
  const result = await createDriverMessageService(cmd.supabase).send(cmd.actor, { loadId: cmd.body!.load_id, body: cmd.body!.body }, cmd.idempotencyKey)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(SendDriverMessageResponseSchema.parse(result.value), { status: 201 })
}
