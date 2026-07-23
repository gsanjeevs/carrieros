// app/api/intake/email/route.ts
// Inbound email load intake (PRD P0: "Dedicated inbound email address
// provisioned at signup" for forwarding rate confirmations straight into
// the load pipeline). This is a webhook, not a user action — there is no
// Supabase session to authenticate, so it's gated by a shared secret
// instead (INTAKE_WEBHOOK_SECRET), the same way any inbound-email-parse
// provider (Mailgun Routes, Postmark Inbound, SendGrid Inbound Parse)
// expects you to verify its webhook calls.
//
// DEMO-MODE SEAM: this route is real and fully functional given a real
// payload — it authenticates the request, resolves the target org from
// the `to` address (see lib/domain/intake-email.ts), runs the same AI
// extraction paste-to-extract already uses, and creates a real draft
// load. What's NOT configured in this project is an actual inbound-email
// provider pointed at this URL (no registered domain, no MX/inbound-parse
// route) — same framing as this codebase's ACH/SMS stubs elsewhere: the
// application-side integration point is complete, the external service
// registration is out of scope for local dev.
//
// Payload shape is intentionally provider-agnostic — {to, from, subject,
// text}. A real Mailgun/Postmark/SendGrid webhook body looks different
// per-provider; wiring a specific one would add a thin adapter mapping
// that provider's body into this shape, not change anything below.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/api-auth'
import { extractLoadFromText, ExtractionFailedError } from '@/lib/extract-load'
import { orgIdFromIntakeEmail } from '@/lib/domain/intake-email'
import { generateLoadNumber } from '@/lib/generate-number'

interface InboundEmailPayload {
  to?: string
  from?: string
  subject?: string
  text?: string
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTAKE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error_code: 'SERVER_ERROR', error: 'INTAKE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }
  if (request.headers.get('x-intake-webhook-secret') !== secret) {
    return NextResponse.json({ error_code: 'FORBIDDEN', error: 'Invalid webhook secret' }, { status: 403 })
  }

  let body: InboundEmailPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error_code: 'VALIDATION_ERROR', error: 'Invalid request body' }, { status: 400 })
  }

  const to = typeof body.to === 'string' ? body.to : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const subject = typeof body.subject === 'string' ? body.subject : ''
  const from = typeof body.from === 'string' ? body.from : null

  const orgId = orgIdFromIntakeEmail(to)
  if (!orgId) {
    return NextResponse.json({ error_code: 'VALIDATION_ERROR', error: 'Could not resolve an organization from the "to" address' }, { status: 400 })
  }

  const bodyText = text.trim() || subject.trim()
  if (bodyText.length < 10) {
    return NextResponse.json({ error_code: 'VALIDATION_ERROR', error: 'Email body is too short to extract a load from' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: org } = await admin
    .from('organizations')
    .select('id, type')
    .eq('id', orgId)
    .eq('type', 'carrier')
    .maybeSingle()

  if (!org) {
    return NextResponse.json({ error_code: 'NOT_FOUND', error: 'No carrier organization matches that intake address' }, { status: 404 })
  }

  let extracted: Record<string, unknown>
  try {
    extracted = await extractLoadFromText(bodyText, { route: 'api/intake/email', orgId })
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      return NextResponse.json({ error_code: 'EXTRACTION_FAILED', error: err.message }, { status: err.status ?? 500 })
    }
    throw err
  }

  const load_number = await generateLoadNumber(admin, orgId)

  const { data: load, error } = await admin
    .from('loads')
    .insert({
      carrier_org_id: orgId,
      load_number,
      status: 'draft',
      intake_method: 'email',
      raw_intake_text: bodyText,
      customer_name_raw: typeof extracted.customer_name_raw === 'string' ? extracted.customer_name_raw : from,
      pickup_address: typeof extracted.pickup_address === 'string' ? extracted.pickup_address : null,
      pickup_city: typeof extracted.pickup_city === 'string' ? extracted.pickup_city : null,
      pickup_state: typeof extracted.pickup_state === 'string' ? extracted.pickup_state : null,
      pickup_zip: typeof extracted.pickup_zip === 'string' ? extracted.pickup_zip : null,
      pickup_date: typeof extracted.pickup_date === 'string' ? extracted.pickup_date : null,
      pickup_time: typeof extracted.pickup_time === 'string' ? extracted.pickup_time : null,
      delivery_address: typeof extracted.delivery_address === 'string' ? extracted.delivery_address : null,
      delivery_city: typeof extracted.delivery_city === 'string' ? extracted.delivery_city : null,
      delivery_state: typeof extracted.delivery_state === 'string' ? extracted.delivery_state : null,
      delivery_zip: typeof extracted.delivery_zip === 'string' ? extracted.delivery_zip : null,
      delivery_date: typeof extracted.delivery_date === 'string' ? extracted.delivery_date : null,
      delivery_time: typeof extracted.delivery_time === 'string' ? extracted.delivery_time : null,
      commodity: typeof extracted.commodity === 'string' ? extracted.commodity : null,
      weight_lbs: typeof extracted.weight_lbs === 'number' ? extracted.weight_lbs : null,
      rate: typeof extracted.rate === 'number' ? extracted.rate : null,
      total_miles: typeof extracted.total_miles === 'number' ? extracted.total_miles : null,
    })
    .select('id, load_number')
    .single()

  if (error) {
    return NextResponse.json({ error_code: 'SERVER_ERROR', error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, load_id: load.id, load_number: load.load_number }, { status: 201 })
}
