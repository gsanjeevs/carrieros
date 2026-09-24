// POST /api/v1/invoices/{id}/send — email a draft invoice to its customer and
// mark it sent. Mobile-facing counterpart to app/api/invoices/[id]/send/route.ts
// (the legacy route, shared with the web 'use server' action via
// lib/invoice-actions.ts). No request body; the route only needs the {id}
// path param, same as mark-paid.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createInvoiceSendService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { SendInvoiceResponseSchema } from '@/server/contract/schemas'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, z.object({}), { requireIdempotencyKey: false, bodyOptional: true })
  if (cmd instanceof NextResponse) return cmd

  const result = await createInvoiceSendService(cmd.supabase).send(cmd.actor, cmd.id)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(SendInvoiceResponseSchema.parse({
    invoice_number: result.value.invoiceNumber,
    ...(result.value.warningCode ? { warning_code: result.value.warningCode } : {}),
  }))
}
