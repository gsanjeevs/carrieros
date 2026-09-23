// lib/invoice-actions.ts
// Shared invoice-mutation logic used by BOTH app/(app)/invoices/actions.ts
// (the 'use server' action web's own UI calls) and the mobile-facing API
// routes under app/api/invoices/[id]/** (server actions aren't callable
// from an external mobile client — they rely on Next's own encoded-POST
// wire format, not a plain fetch). Factored out here so the "email must
// succeed before status flips" rule and the tracking-pixel embed live in
// exactly one place instead of being duplicated per caller.
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/send-email'
import { formatMoney } from '@/lib/format-money'

export type InvoiceMutationResult =
  | { ok: true; invoice_number: string; warning_code?: string }
  | { ok: false; error_code: string }

/**
 * Marks an invoice as sent — emails it (real SMTP send) to the customer's
 * address on file, with an embedded open-tracking pixel, THEN flips the
 * status. Order matters: if the send fails, the invoice must not show as
 * sent, so the email goes out first and only a successful send (or a
 * documented no-recipient case) proceeds to the DB update.
 */
export async function sendInvoiceAndMarkSent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches createClient()'s generic-less return type used across this codebase's server actions
  supabase: SupabaseClient<any>,
  orgId: number,
  invoiceId: number
): Promise<InvoiceMutationResult> {
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(`
      invoice_number, amount, due_date, customer_org_id,
      loads ( load_number, tracking_token ),
      organizations!invoices_customer_org_id_fkey ( name, email )
    `)
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .maybeSingle()

  if (invoiceError) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!invoice) return { ok: false, error_code: 'NOT_FOUND' }

  const customerOrg = Array.isArray(invoice.organizations)
    ? invoice.organizations[0]
    : invoice.organizations
  const load = Array.isArray(invoice.loads) ? invoice.loads[0] : invoice.loads
  const recipient = customerOrg?.email ?? null

  let warningCode: string | undefined
  if (recipient) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const trackingLink = load?.tracking_token ? `${appUrl}/track/${load.tracking_token}` : null
    // 1x1 open-tracking pixel — app/api/invoices/[id]/track/route.ts is a
    // public, unauthenticated route (the recipient's mail client has no
    // CarrierOS session) that stamps invoices.opened_at the first time it's
    // fetched and always returns a transparent GIF regardless of outcome.
    const trackingPixel = `<img src="${appUrl}/api/invoices/${invoiceId}/track" width="1" height="1" alt="" style="display:none" />`

    const html = `
      <p>Hello${customerOrg?.name ? ` ${customerOrg.name}` : ''},</p>
      <p>Invoice <strong>${invoice.invoice_number}</strong> for
      <strong>${formatMoney(invoice.amount)}</strong> is now due${invoice.due_date ? ` by ${invoice.due_date}` : ''}.</p>
      ${trackingLink ? `<p><a href="${trackingLink}">Track this shipment</a></p>` : ''}
      <p>— CarrierOS</p>
      ${trackingPixel}
    `.trim()

    const result = await sendEmail({
      to: recipient,
      subject: `Invoice ${invoice.invoice_number}`,
      html,
    })

    if (!result.ok) return { ok: false, error_code: 'EMAIL_SEND_FAILED' }
  } else {
    // No customer contact email on file. Documented behavior: still mark
    // the invoice sent — the carrier may be sending it by another means —
    // but surface a warning rather than silently pretending an email went out.
    warningCode = 'NO_RECIPIENT_EMAIL'
  }

  // Atomic status change + outbox event (T19 readiness layer, migration 0033) —
  // replaces the old plain UPDATE. The email above already went out and is not
  // part of this transaction (it cannot be — it's an external side effect); this
  // call only makes the DB write and its outbox fact indivisible. Idempotency key
  // is deterministic per invoice: an invoice only ever transitions to 'sent' once
  // from this path (a second call would target the same status row, which the RPC
  // reports back as NOT_FOUND once status has moved on — the outbox key existing
  // is what actually prevents a duplicate InvoiceSent event on any true retry).
  const sentAt = new Date().toISOString()
  const idempotencyKey = `invoice:${invoiceId}:sent`
  const { data: cmdData, error: cmdError } = await supabase.rpc('mark_invoice_sent_command', {
    p_invoice_id: invoiceId,
    p_sent_at: sentAt,
    p_correlation_id: crypto.randomUUID(),
    p_idempotency_key: idempotencyKey,
  })

  if (cmdError) {
    if (cmdError.code === 'PT404') return { ok: false, error_code: 'NOT_FOUND' }
    return { ok: false, error_code: 'SERVER_ERROR' }
  }
  const row = cmdData as unknown as { invoice_number: string } | null
  if (!row) return { ok: false, error_code: 'NOT_FOUND' }

  return { ok: true, invoice_number: row.invoice_number, warning_code: warningCode }
}
