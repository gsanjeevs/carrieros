// The legacy endpoint exposed a Supabase magic-link that authenticated a staff member as a carrier
// owner. It is intentionally retired; use the actor-bound, read-only support-access workflow instead.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_impersonate')
  if (isErrorResponse(ctx)) return ctx
  return NextResponse.json(
    { error: 'This sign-in-as-user endpoint is retired. Start a read-only audited support session instead.' },
    { status: 410 }
  )
}
