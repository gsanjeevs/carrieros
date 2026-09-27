// GET /api/v1/reports/ifta-quarterly/export — mockup-17's missing "IFTA
// Report"/"Export Q_" filing button on the Pro Finance & IFTA Hub
// (app/(app)/finance/page.tsx). That page already computes this exact data
// via the get_ifta_tax_summary RPC for its on-screen breakdown table;
// IftaService.taxSummaryForExport() reuses the same RPC (through
// IftaRepository.taxSummary(), never a direct .rpc() call here) and this
// route hands the result back as a CSV attachment instead, so the numbers can
// never drift between what's shown and what's exported. Same gates as the
// page itself: Pro-tier (ifta_tax_hub) + 'finance' capability.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createIftaService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { IftaQuarterlySummaryQuerySchema } from '@/server/contract/schemas'

function csvField(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const query = IftaQuarterlySummaryQuerySchema.safeParse({ quarter: request.nextUrl.searchParams.get('quarter') })
  if (!query.success) return apiError('VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createIftaService(authed.supabase).taxSummaryForExport(actor.value, query.data.quarter)
  if (!result.ok) return domainErrorResponse(result.error)

  const header = ['State', 'Miles', 'Net Tax Due']
  const lines = [header, ...result.value.map((r) => [r.state, Math.round(r.miles_in_state), r.net_tax_due.toFixed(2)])]
  const csv = lines.map((line) => line.map(csvField).join(',')).join('\r\n') + '\r\n'

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ifta-${query.data.quarter}.csv"`,
    },
  })
}
