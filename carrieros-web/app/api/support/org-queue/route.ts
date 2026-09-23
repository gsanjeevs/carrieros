// app/api/support/org-queue/route.ts
// Org_support staff console (decisions.md T16, Enterprise-gated) — lists ALL org_support-queue
// tickets for the caller's own org (not just their own submitted tickets, unlike GET
// /api/support/tickets). Runs through the caller's session client; the org_support_staff_select RLS
// policy (migration 0027: role IN owner/solo AND has_feature('support_desk') AND carrier_org_id =
// my_org_id()) is what actually restricts this to the caller's own org's staff — same "RLS is the
// real boundary, route is a thin pass-through" shape as every other RLS-gated list route.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase } = ctx

  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('queue', 'org_support')
    .order('created_at', { ascending: false })

  if (error) return apiError('SERVER_ERROR', error.message, 500)

  return NextResponse.json({ tickets: tickets ?? [] })
}
