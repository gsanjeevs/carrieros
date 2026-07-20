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
import { revalidatePath } from 'next/cache'

export type ActionResult =
  | { ok: true; invoice_number?: string }
  | { ok: false; error_code: string }

const BILLING_ROLES = ['owner', 'solo', 'finance']
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return { error_code: 'NOT_ONBOARDED' as const }
  if (!BILLING_ROLES.includes(profile.role)) return { error_code: 'FORBIDDEN' as const }

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

  const { data: load, error: loadError } = await supabase
    .from('loads')
    .select('id, load_number, status, rate, customer_org_id, carrier_org_id')
    .eq('id', loadId)
    .eq('carrier_org_id', orgId)
    .maybeSingle()

  if (loadError) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!load) return { ok: false, error_code: 'NOT_FOUND' }

  // Only a load that has actually been delivered can be billed. 'invoiced' is
  // allowed too: the status may already have been advanced by hand, and the
  // unique index below is the real guard against a duplicate.
  if (!['delivered', 'invoiced'].includes(load.status ?? '')) {
    return { ok: false, error_code: 'LOAD_NOT_DELIVERED' }
  }

  // One invoice per load (enforced by UNIQUE INDEX invoices_load_unique).
  // Checked here first so the common case never reaches the DB error path —
  // and, critically, never burns an invoice number.
  const { data: existing, error: existingError } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('load_id', load.id)
    .maybeSingle()

  if (existingError) return { ok: false, error_code: 'SERVER_ERROR' }
  if (existing) return { ok: false, error_code: 'INVOICE_EXISTS' }

  // Default payment method comes from the carrier's own setting (decision R1).
  const { data: carrier } = await supabase
    .from('carrier_details')
    .select('default_payment_method, factoring_company')
    .eq('org_id', orgId)
    .maybeSingle()

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + NET_DAYS)

  // Everything above is validated — safe to burn a sequence value now.
  let invoiceNumber: string
  try {
    invoiceNumber = await generateInvoiceNumber(supabase, orgId)
  } catch {
    return { ok: false, error_code: 'SERVER_ERROR' }
  }

  const paymentMethod = carrier?.default_payment_method ?? 'other'

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      carrier_org_id:  orgId,
      customer_org_id: load.customer_org_id,
      load_id:         load.id,
      invoice_number:  invoiceNumber,
      amount:          Number(load.rate ?? 0),
      status:          'draft',
      due_date:        dueDate.toISOString().slice(0, 10),
      payment_method:  paymentMethod,
      factoring_company:
        paymentMethod === 'factoring' ? carrier?.factoring_company ?? null : null,
    })
    .select('invoice_number')
    .single()

  if (error) {
    // 23505 = unique violation — someone else invoiced this load in the gap
    // between the check above and this insert.
    if (error.code === '23505') return { ok: false, error_code: 'INVOICE_EXISTS' }
    return { ok: false, error_code: 'SERVER_ERROR' }
  }

  // Advance the load's own status so the two views agree.
  if (load.status === 'delivered') {
    await supabase.from('loads').update({ status: 'invoiced' }).eq('id', load.id)
  }

  revalidatePath('/invoices')
  revalidatePath(`/loads/${load.load_number}`)
  return { ok: true, invoice_number: invoice.invoice_number }
}

/**
 * Marks an invoice as sent.
 *
 * This is a STATE TRANSITION ONLY — nothing is emailed. There is no email
 * provider wired into this project, so the UI says "Mark as Sent" rather than
 * "Send", and this records that the carrier sent it by their own means.
 */
export async function markInvoiceSent(invoiceId: number): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .select('invoice_number')
    .maybeSingle()

  if (error) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!data) return { ok: false, error_code: 'NOT_FOUND' }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${data.invoice_number}`)
  return { ok: true, invoice_number: data.invoice_number }
}

/** Marks an invoice paid. */
export async function markInvoicePaid(invoiceId: number): Promise<ActionResult> {
  const ctx = await billingContext()
  if ('error_code' in ctx) return { ok: false, error_code: ctx.error_code }
  const { supabase, orgId } = ctx

  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('carrier_org_id', orgId)
    .select('invoice_number, load_id')
    .maybeSingle()

  if (error) return { ok: false, error_code: 'SERVER_ERROR' }
  if (!data) return { ok: false, error_code: 'NOT_FOUND' }

  if (data.load_id) {
    await supabase.from('loads').update({ status: 'paid' }).eq('id', data.load_id)
  }

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
