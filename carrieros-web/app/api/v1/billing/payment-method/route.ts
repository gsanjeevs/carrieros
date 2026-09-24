import { NextRequest, NextResponse } from 'next/server'
import { createSetupWriteService } from '@/server/composition'
import { AddPaymentMethodResponseSchema } from '@/server/contract/schemas'
import { domainErrorResponse } from '@/server/http-errors'
import { isHttpResponse, parseResourceRequest } from '@/server/http-resource'

export async function POST(request: NextRequest) {
  const cmd = await parseResourceRequest(request)
  if (isHttpResponse(cmd)) return cmd
  const result = await createSetupWriteService(cmd.supabase).addPaymentMethod(cmd.actor, cmd.idempotencyKey)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(AddPaymentMethodResponseSchema.parse(result.value))
}
