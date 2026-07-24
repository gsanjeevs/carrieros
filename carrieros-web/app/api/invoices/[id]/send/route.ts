// app/api/invoices/[id]/send/route.ts
// Mobile-facing counterpart to app/(app)/invoices/actions.ts's
// markInvoiceSent server action — 'use server' actions rely on Next's own
// encoded-POST wire format, which an external mobile client can't call
// directly, so mobile's "mark sent" write needs its own route. Shares the
// exact same email-send + status-flip logic via lib/invoice-actions.ts
// rather than duplicating it.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, type ErrorCode } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { INVOICE_ROLES } from '@/lib/roles-policy'
import { sendInvoiceAndMarkSent } from '@/lib/invoice-actions'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!INVOICE_ROLES.includes(profile.role)) return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const { id } = await params
  const invoiceId = Number(id)
  if (!Number.isFinite(invoiceId)) return apiError('VALIDATION_ERROR', 'Invalid invoice id', 400)

  const result = await sendInvoiceAndMarkSent(supabase, profile.org_id, invoiceId)
  if (!result.ok) return apiError(result.error_code as ErrorCode, 'Could not send invoice', result.error_code === 'NOT_FOUND' ? 404 : 500)

  return NextResponse.json({ invoice_number: result.invoice_number, warning_code: result.warning_code })
}
