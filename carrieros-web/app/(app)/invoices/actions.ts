'use server'
// app/(app)/invoices/actions.ts
// Plain RLS-protected CRUD → talks DIRECTLY to Supabase (decisions.md R3b).
// No API route: none of these need a server secret or the service-role bypass.
// `invoices` RLS (`billing_invoices_all`) already restricts every statement here
// to owner/solo/finance inside the caller's own org; the explicit role checks
// below exist only so the UI can show a meaningful error instead of "0 rows".
//
// Actions return a stable `error_code` (the same vocabulary as lib/api-auth.ts)
// which the client maps to a localized string via messages/{locale}.json.

import { createClient } from '@/lib/supabase/server'
import { generateInvoiceNumber } from '@/lib/generate-number'
import { sendInvoiceAndMarkSent } from '@/lib/invoice-actions'
import { revalidatePath } from 'next/cache'
import { INVOICE_ROLES } from '@/lib/roles-policy'
import { getProfileForUser } from '@/lib/queries/profiles'
import { getLoadForOrg } from '@/lib/queries/loads'

export type ActionResult =
  | { ok: true; invoice_number?: string; invoice_numbers?: string[]; warning_code?: string }
  | { ok: false; error_code: string }
const PAYMENT_METHODS = ['stripe', 'factoring', 'other']

// Net-30 by default.
const NET_DAYS = 30

type BillingContext =
  | { error_code: string }
  | { supabase: Awaited<ReturnType<typeof createClient>>; orgId: number; role: string }

async function billingContext(): Promise<BillingContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error_code: 'AUTH_REQUIRED' as const }

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return { error_code: 'NOT_ONBOARDED' as const }
  if (!INVOICE_ROLES.includes(profile.role)) return { error_code: 'FORBIDDEN' as const }

  return { supabase, orgId: profile.org_id, role: profile.role }
}

/**
 * Creates the invoice for a delivered load.
 *
 * Order matters: EVERY validation runs before generateInvoiceNumber(), because
 * next_entity_val() burns a sequence value on each call — a number generated
 * for a create that then fails would leave a permanent gap in the carrier's
 * invoice numbering (this exact bug shipped once before, git 0a33e55).
 */
export async function createInvoiceForLoad(loadId: number): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  const { data: load, error: loadError } = await getLoadForOrg(supabase, loadId, orgId)

  if (loadError) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!load) return { ok: false, error_code: 'NOT_FOUND' }

  // Only a delivered load can be billed; invoiced loads remain eligible for
  // any remaining customer invoices when a multi-customer load is billed.
  if (!['delivered', 'invoiced'].includes(load.status ?? '')) {
    return { ok: false, error_code: 'LOAD_NOT_DELIVERED' }
  }

  const [{ data: orderRows, error: orderError }, { data: existingInvoices, error: invoiceError }] = await Promise.all([
    supabase.from('load_orders').select('id, customer_org_id, billable_amount').eq('carrier_org_id', orgId).eq('load_id', load.id),
    supabase.from('invoices').select('customer_org_id, invoice_number').eq('carrier_org_id', orgId).eq('load_id', load.id),
  ])
  if (orderError || invoiceError) return { ok: false, error_code: 'SERVER_ERROR' }

  const groups = new Map<number | null, number>()
  if (orderRows?.length) {
    if (orderRows.some((order) => order.billable_amount == null)) return { ok: false, error_code: 'VALIDATION_ERROR' }
    const total = orderRows.reduce((sum, order) => sum + Number(order.billable_amount), 0)
    if (Math.round(total * 100) !== Math.round(Number(load.rate ?? 0) * 100)) return { ok: false, error_code: 'VALIDATION_ERROR' }
    for (const order of orderRows) groups.set(order.customer_org_id, (groups.get(order.customer_org_id) ?? 0) + Number(order.billable_amount))
  } else {
    groups.set(load.customer_org_id as number | null, Number(load.rate ?? 0))
  }

  const alreadyInvoiced = new Set((existingInvoices ?? []).map((invoice) => invoice.customer_org_id))
  const pendingGroups = [...groups].filter(([customerId]) => !alreadyInvoiced.has(customerId))
  if (pendingGroups.length === 0) return { ok: false, error_code: 'INVOICE_EXISTS' }

  // Default payment method comes from the carrier's own setting (decision R1).
  const { data: carrier } = await supabase
    .from('carrier_details')
    .select('default_payment_method, factoring_company')
    .eq('org_id', orgId)
    .maybeSingle()

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + NET_DAYS)

  // All charge allocations are validated before numbering. Each customer gets
  // one invoice containing their orders; the RPC persists the batch atomically.
  const invoiceRows: Array<{ customer_org_id: number | null; invoice_number: string; amount: number }> = []
  for (const [customerId, amount] of pendingGroups) {
    try {
      invoiceRows.push({ customer_org_id: customerId, invoice_number: await generateInvoiceNumber(supabase, orgId), amount })
    } catch {
      return { ok: false, error_code: 'SERVER_ERROR' }
    }
  }

  const paymentMethod = carrier?.default_payment_method ?? 'other'

  // Atomic invoice batch + order allocations + load status advance + outbox.
  const { data: cmdData, error } = await supabase.rpc('create_load_invoices_command', {
    p_load_id: load.id,
    p_invoice_rows: invoiceRows as unknown as import('@/types/supabase').Json,
    p_due_date: dueDate.toISOString().slice(0, 10),
    p_payment_method: paymentMethod,
    p_factoring_company: (paymentMethod === 'factoring' ? carrier?.factoring_company ?? null : null) as string,
    p_advance_load_status: load.status === 'delivered',
    p_correlation_id: crypto.randomUUID(),
    p_idempotency_key: `invoice:create:${load.id}`,
  })

  if (error) {
    if (error.code === '23505' || error.message?.includes('INVOICE_EXISTS')) return { ok: false, error_code: 'INVOICE_EXISTS' }
    if (error.code === 'PT400') return { ok: false, error_code: 'VALIDATION_ERROR' }
    if (error.code === 'PT404') return { ok: false, error_code: 'NOT_FOUND' }
    return { ok: false, error_code: 'SERVER_ERROR' }
  }
  const invoiceNumbers = ((cmdData as { invoices?: Array<{ invoice_number: string }> } | null)?.invoices ?? []).map((invoice) => invoice.invoice_number)
  if (invoiceNumbers.length === 0) return { ok: false, error_code: 'SERVER_ERROR' }

  revalidatePath('/invoices')
  revalidatePath(`/loads/${load.load_number}`)
  return { ok: true, invoice_number: invoiceNumbers[0], invoice_numbers: invoiceNumbers }
}

/**
 * Marks an invoice as sent.
 *
 * This actually emails the invoice (via lib/send-email.ts — real SMTP send,
 * routed to local Mailpit in dev, to whatever SMTP_HOST points at in prod)
 * to the customer's address on file, THEN flips the status. Order matters:
 * if the send fails, the invoice must not show as sent — so the email goes
 * out first and only a successful send (or a documented no-recipient case)
 * proceeds to the DB update.
 */
export async function markInvoiceSent(invoiceId: number): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  const result = await sendInvoiceAndMarkSent(supabase, orgId, invoiceId)
  if (!result.ok) return result

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${result.invoice_number}`)
  return result
}

/** Marks an invoice paid. */
export async function markInvoicePaid(invoiceId: number): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  // Delegates to the same atomic mark_invoice_paid RPC (migration 0014, extended
  // by 0033 with outbox emission) the /api/v1 path uses, instead of the old
  // plain UPDATE + separate updateLoadStatus call — one implementation for
  // "invoice paid" instead of two that could drift.
  const { data: cmdData, error } = await supabase.rpc('mark_invoice_paid', {
    p_invoice_id: invoiceId,
    p_paid_at: new Date().toISOString(),
    p_correlation_id: crypto.randomUUID(),
    p_idempotency_key: `invoice:${invoiceId}:paid`,
  })
  if (error) {
    if (error.code === 'PT404') return { ok: false, error_code: 'NOT_FOUND' }
    return { ok: false, error_code: 'SERVER_ERROR' }
  }

  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .maybeSingle()
  if (!invoiceRow) return { ok: false, error_code: 'NOT_FOUND' }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceRow.invoice_number}`)
  return { ok: true, invoice_number: invoiceRow.invoice_number }
}

/**
 * Edits an invoice's amount/due_date/notes before it's sent (audit's #3
 * gap, docs/feature-completeness-audit.md: "Review + edit invoice before
 * sending — Missing"). Deliberately draft-only: once an invoice has been
 * emailed to a customer (status 'sent'/'paid'/'overdue'), silently
 * rewriting the amount behind their back is exactly the kind of billing
 * surprise this restriction exists to prevent — see PRD edge case #11
 * ("invoice sent, then rate corrected — must re-issue"), which implies a
 * correction after sending is a new/re-issued invoice, not a silent edit.
 */
export async function updateInvoiceDraft(
  invoiceId: number,
  fields: { amount: number; due_date: string | null; notes: string | null }
): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  if (!Number.isFinite(fields.amount) || fields.amount <= 0) {
    return { ok: false, error_code: 'VALIDATION_ERROR' }
  }

  const { data: current, error: readError } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .maybeSingle()

  if (readError) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!current) return { ok: false, error_code: 'NOT_FOUND' }
  if (current.status !== 'draft') return { ok: false, error_code: 'VALIDATION_ERROR' }

  const { data, error } = await supabase
    .from('invoices')
    .update({
      amount: fields.amount,
      due_date: fields.due_date || null,
      notes: fields.notes || null,
    })
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .eq('status', 'draft')
    .select('invoice_number')
    .maybeSingle()

  if (error) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!data) return { ok: false, error_code: 'NOT_FOUND' }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${data.invoice_number}`)
  return { ok: true, invoice_number: data.invoice_number }
}

/** Changes how this invoice is meant to be collected (decision R1). */
export async function setInvoicePaymentMethod(
  invoiceId: number,
  method: string
): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  if (!PAYMENT_METHODS.includes(method)) {
    return { ok: false, error_code: 'VALIDATION_ERROR' }
  }

  const { data, error } = await supabase
    .from('invoices')
    .update({ payment_method: method })
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .select('invoice_number')
    .maybeSingle()

  if (error) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!data) return { ok: false, error_code: 'NOT_FOUND' }

  revalidatePath(`/invoices/${data.invoice_number}`)
  revalidatePath('/invoices')
  return { ok: true, invoice_number: data.invoice_number }
}
