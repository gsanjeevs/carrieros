// app/api/cron/send-reminders/route.ts
//
// POST /api/cron/send-reminders — invokes send_expiry_reminders() (SECTION 8,
// schema.sql) to write new exception_events rows for drivers/vehicles/orgs
// with an expiring CDL, medical cert, or compliance document, then emails
// each affected carrier's owner/solo user(s) via lib/send-email.ts.
//
// CURRENT STATE: the logic here is real and callable end-to-end (DB write +
// email send), but nothing calls this route on a schedule yet. This
// Postgres instance does not have pg_cron installed, and installing it (or
// picking an external scheduler — e.g. AWS EventBridge Scheduler hitting
// this route, since the app runs on ECS — is a deployment-environment
// decision deferred to later, not made by this change. Until then, trigger manually:
//   curl -X POST http://localhost:3000/api/cron/send-reminders \
//     -H "Authorization: Bearer $CRON_SECRET"
//
// Protected by a shared secret (CRON_SECRET env var) rather than a user
// session — there is no logged-in user for a scheduled job to act as, and
// send_expiry_reminders() itself is service_role-only (EXECUTE revoked from
// authenticated/anon in schema.sql) for the same reason.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/send-email'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { getOrgOwnersAndSolos } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // No secret configured: refuse rather than silently running unprotected.
  if (!secret) return false

  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (bearer === secret) return true

  const queryToken = request.nextUrl.searchParams.get('token')
  return queryToken === secret
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error_code: 'FORBIDDEN', error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const authAdmin = createAuthAdminProvider(admin)

  // 1) Run the detection + write pass. Returns the count of NEW
  // exception_events rows created this call (already dedup'd against the
  // last 24h inside the function).
  const { data: newCount, error: rpcError } = await admin.rpc('send_expiry_reminders')

  if (rpcError) {
    logError({ route: 'cron/send-reminders', requestId: request.headers.get('x-request-id') }, rpcError.message, { step: 'send_expiry_reminders() failed' })
    return NextResponse.json(
      { error_code: 'SERVER_ERROR', error: rpcError.message },
      { status: 500 }
    )
  }

  const createdCount = newCount ?? 0

  if (createdCount === 0) {
    return NextResponse.json({ reminders_created: 0, emails_sent: 0, emails_failed: 0 })
  }

  // 2) Fetch the reminder rows just created (last 5 minutes is a generous
  // window for "this run" — the dedup inside send_expiry_reminders() already
  // prevents re-notifying for the same thing within 24h regardless).
  const { data: newEvents, error: eventsError } = await admin
    .from('exception_events')
    .select('id, carrier_org_id, entity_type, entity_id, severity, title, detail, created_at')
    .eq('event_type', 'reminder_sent')
    .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })

  if (eventsError) {
    logError({ route: 'cron/send-reminders', requestId: request.headers.get('x-request-id') }, eventsError.message, { step: 'Failed to read back new events' })
    return NextResponse.json(
      { reminders_created: createdCount, emails_sent: 0, emails_failed: 0, warning: 'EVENTS_READBACK_FAILED' },
      { status: 200 }
    )
  }

  const events = newEvents ?? []
  const orgIds = [...new Set(events.map((e) => e.carrier_org_id))]

  let emailsSent = 0
  let emailsFailed = 0

  // 3) One digest email per affected carrier org, sent to every owner/solo
  // user on that org (the roles that actually see this in the exceptions
  // inbox — dispatcher/finance/driver are not compliance-notification
  // targets here).
  for (const orgId of orgIds) {
    const orgEvents = events.filter((e) => e.carrier_org_id === orgId)

    const { data: recipients, error: profilesError } = await getOrgOwnersAndSolos(admin, orgId)

    if (profilesError || !recipients?.length) {
      emailsFailed += 1
      continue
    }

    const html = `
      <p>${orgEvents.length} new compliance reminder${orgEvents.length === 1 ? '' : 's'}:</p>
      <ul>
        ${orgEvents.map((e) => `<li><strong>${e.title}</strong>${e.detail ? ` — ${e.detail}` : ''}</li>`).join('')}
      </ul>
      <p>— CarrierOS</p>
    `.trim()

    for (const recipient of recipients) {
      const { data: userData, error: userError } = await authAdmin.getUserById(recipient.id)
      const email = userData?.user?.email
      if (userError || !email) {
        emailsFailed += 1
        continue
      }

      const result = await sendEmail({
        to: email,
        subject: `CarrierOS: ${orgEvents.length} compliance reminder${orgEvents.length === 1 ? '' : 's'}`,
        html,
      })

      if (result.ok) emailsSent += 1
      else emailsFailed += 1
    }
  }

  return NextResponse.json({
    reminders_created: createdCount,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
  })
}
