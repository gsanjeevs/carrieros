// app/api/invoices/[id]/track/route.ts
// Email-open tracking pixel (invoicing-gap audit). Embedded as a 1x1 <img>
// in the invoice email built by lib/invoice-actions.ts. Deliberately public/
// unauthenticated — the recipient's mail client fetches this with no
// CarrierOS session, same reason app/track/[token] is anon-facing. Uses the
// admin client (no user context exists) and always returns a transparent
// GIF regardless of outcome, so a bad/guessed id can't be distinguished
// from a real one by the response.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Smallest valid transparent GIF (43 bytes), base64-encoded.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
)

function gifResponse() {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoiceId = Number(id)
  if (!Number.isFinite(invoiceId)) return gifResponse()

  const admin = createAdminClient()
  // Only the first open is recorded — .is('opened_at', null) means a
  // second/third fetch (forwarded email, re-opened later) is a no-op rather
  // than overwriting the original open timestamp.
  await admin
    .from('invoices')
    .update({ opened_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .is('opened_at', null)

  return gifResponse()
}
