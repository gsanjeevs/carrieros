// app/api/loads/[id]/send-documents/route.ts
// POST — email selected load documents (POD/BOL/rate con/other) to the
// customer or broker as real attachments. PRD P0: "POD/BOL cannot be sent
// to broker/customer from the app — only invoices can be emailed." Reuses
// lib/send-email.ts (real SMTP send, routed to local Mailpit in dev) —
// the same infra app/(app)/invoices/actions.ts's markInvoiceSent() already
// uses, just with attachments this time instead of a body-only email.
//
// Same role gate as document upload (canUploadDoc in the load detail
// page): owner/solo/dispatcher. Finance can view documents but sending
// them to an external party is a dispatch-adjacent action, not billing.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { getLoadForOrg } from '@/lib/queries/loads'
import { createStorageProvider } from '@/lib/storage'
import { sendEmail, type SendEmailAttachment } from '@/lib/send-email'

const SEND_ROLES = ['owner', 'solo', 'dispatcher']
const MAX_DOCS = 10

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loadId = Number(id)
  if (!Number.isInteger(loadId)) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)

  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!SEND_ROLES.includes(profile.role)) return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()
  const documentIds = Array.isArray(body.document_ids) ? body.document_ids.map(Number) : []
  const recipientOverride = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : ''

  if (documentIds.length === 0 || documentIds.length > MAX_DOCS || documentIds.some((n: number) => !Number.isInteger(n)))
    return apiError('VALIDATION_ERROR', `Select 1-${MAX_DOCS} documents`, 400)

  const { data: load, error: loadError } = await getLoadForOrg(supabase, loadId, profile.org_id)

  if (loadError) return apiError('SERVER_ERROR', loadError.message, 500)
  if (!load) return apiError('NOT_FOUND', 'Load not found', 404)

  let recipient = recipientOverride
  let customerName: string | null = load.customer_name_raw
  if (!recipient && load.customer_org_id) {
    const { data: customerOrg } = await supabase
      .from('organizations')
      .select('name, email')
      .eq('id', load.customer_org_id)
      .maybeSingle()
    recipient = customerOrg?.email ?? ''
    customerName = customerOrg?.name ?? customerName
  }

  if (!recipient)
    return apiError('VALIDATION_ERROR', 'No customer email on file — provide a recipient email', 400)

  const { data: docRows, error: docError } = await supabase
    .from('documents')
    .select('id, type, storage_path')
    .eq('load_id', loadId)
    .eq('carrier_org_id', profile.org_id)
    .in('id', documentIds)

  if (docError) return apiError('SERVER_ERROR', docError.message, 500)
  if (!docRows || docRows.length === 0) return apiError('NOT_FOUND', 'No matching documents found', 404)

  const storage = createStorageProvider(supabase)
  const attachments: SendEmailAttachment[] = []
  for (const doc of docRows) {
    try {
      const blob = await storage.download(doc.storage_path)
      const buffer = Buffer.from(await blob.arrayBuffer())
      const filename = doc.storage_path.split('/').pop()?.replace(/^\d{10,}-/, '') ?? `${doc.type}.bin`
      attachments.push({ filename, content: buffer, contentType: blob.type || undefined })
    } catch {
      return apiError('SERVER_ERROR', `Failed to load document ${doc.id} for sending`, 500)
    }
  }

  const html = `
    <p>Hello${customerName ? ` ${customerName}` : ''},</p>
    <p>Attached are ${attachments.length === 1 ? 'the document' : `${attachments.length} documents`} for load
    <strong>${load.load_number}</strong>.</p>
    <p>— CarrierOS</p>
  `.trim()

  const result = await sendEmail({
    to: recipient,
    subject: `Documents for load ${load.load_number}`,
    html,
    attachments,
  })

  if (!result.ok) return apiError('EMAIL_SEND_FAILED', result.error ?? 'Failed to send email', 500)

  await supabase.from('load_events').insert({
    load_id: loadId,
    event_type: 'documents_sent',
    note: `Sent ${attachments.length} document(s) to ${recipient}`,
    created_by: user.id,
  })

  return NextResponse.json({ ok: true, sent_to: recipient, count: attachments.length })
}
