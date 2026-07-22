// app/api/invoices/[id]/factor/route.ts
//
// POST /api/invoices/:id/factor — hand an invoice to the carrier's factoring
// company (decision R1).
//
// WHY THIS IS AN API ROUTE AND THE REST OF THE INVOICE FLOW IS NOT:
// per decisions.md R3b, plain RLS-protected CRUD talks directly to Supabase
// and gets no Next.js layer. This one does, because it is the seam where a
// real factoring integration (TriumphPay) will need a server-held API
// credential that must never reach the browser or the Expo bundle. Putting
// the seam in now means the swap is a single function body — notifyFactor()
// below — and no client-side change.
//
// WHAT IT DOES TODAY: validates the request, records factoring_company /
// factoring_reference / factored_at on the invoice, and logs the notification
// payload it WOULD transmit. Nothing leaves this process. This is a
// deliberate stub, not an unfinished integration.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { INVOICE_ROLES } from '@/lib/roles-policy'

/** The one thing a real integration replaces. */
export interface FactoringNotification {
  invoice_number: string
  amount: number
  currency: string
  due_date: string | null
  load_number: string | null
  carrier_org_id: number
  customer_name: string | null
  factoring_company: string
  factoring_reference: string | null
}

/**
 * TODO(TriumphPay): replace this body with the real submission call.
 *
 * The user has chosen a notify-stub for now and will partner with a factoring
 * company (TriumphPay) later. The request/response shape of their API is NOT
 * known here and is deliberately not guessed — when the partnership is signed,
 * this function becomes: authenticate with the partner credential (a new
 * server-only env var), POST the mapped payload, and return their reference id
 * so the caller can persist it as factoring_reference.
 *
 * Everything else in this route (auth, role gate, validation, the DB write,
 * the error_code contract, the client) stays exactly as it is.
 */
async function notifyFactor(payload: FactoringNotification): Promise<void> {
  console.log(
    '[factoring:stub] no factoring partner is configured — nothing was transmitted.',
    JSON.stringify(payload, null, 2)
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const invoiceId = Number(id)
  if (!Number.isInteger(invoiceId)) {
    return apiError('VALIDATION_ERROR', 'Invalid invoice id', 400)
  }

  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!INVOICE_ROLES.includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  let body: { factoring_company?: unknown; factoring_reference?: unknown }
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }

  const company =
    typeof body.factoring_company === 'string' ? body.factoring_company.trim() : ''
  const reference =
    typeof body.factoring_reference === 'string' ? body.factoring_reference.trim() : ''

  if (!company) return apiError('VALIDATION_ERROR', 'factoring_company is required', 400)

  const { data: invoice, error: readError } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, amount, due_date, payment_method, carrier_org_id, loads(load_number, customer_name_raw)'
    )
    .eq('id', invoiceId)
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (readError) return apiError('SERVER_ERROR', readError.message, 500)
  if (!invoice) return apiError('NOT_FOUND', 'Invoice not found', 404)

  if (invoice.payment_method !== 'factoring') {
    return apiError(
      'NOT_FACTORING',
      'Invoice payment method is not set to factoring',
      400
    )
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', invoice.carrier_org_id)
    .maybeSingle()

  const factoredAt = new Date().toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('invoices')
    .update({
      factoring_company:   company,
      factoring_reference: reference || null,
      factored_at:         factoredAt,
    })
    .eq('id', invoiceId)
    .eq('carrier_org_id', profile.org_id)
    .select('id, invoice_number, factoring_company, factoring_reference, factored_at')
    .single()

  if (updateError) return apiError('SERVER_ERROR', updateError.message, 500)

  await notifyFactor({
    invoice_number:      invoice.invoice_number,
    amount:              Number(invoice.amount),
    currency:            org?.currency ?? 'USD',
    due_date:            invoice.due_date,
    load_number:         invoice.loads?.load_number ?? null,
    carrier_org_id:      invoice.carrier_org_id,
    customer_name:       invoice.loads?.customer_name_raw ?? null,
    factoring_company:   company,
    factoring_reference: reference || null,
  })

  // `notified: false` is honest: the row was updated, but no partner was
  // contacted. Flip this when notifyFactor() actually transmits.
  return NextResponse.json({ ...updated, notified: false })
}
