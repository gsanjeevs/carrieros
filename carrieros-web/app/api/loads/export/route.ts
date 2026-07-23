// app/api/loads/export/route.ts
// GET — CSV export of loads + revenue for a date range (audit's #4 gap,
// docs/feature-completeness-audit.md: "CSV export of loads/revenue does
// not exist at all"). PRD is explicit: "CSV export of all loads + revenue
// for a selected date range" (P0) — filters by pickup_date when both
// `from`/`to` query params are given, otherwise exports everything.
//
// INVOICE_ROLES-gated (owner/solo/finance) — same role set as the rest of
// the billing surface (lib/roles-policy.ts), matching the PRD's own framing
// of this as "give my accountant what they need at tax time."
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { INVOICE_ROLES } from '@/lib/roles-policy'

const CSV_HEADER = [
  'load_number', 'status', 'customer', 'pickup_city', 'pickup_state', 'pickup_date',
  'delivery_city', 'delivery_state', 'delivery_date', 'commodity', 'total_miles', 'rate',
]

// RFC 4180: a field containing a comma, quote, or newline must be quoted,
// with internal quotes doubled. Everything else passes through as-is.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!INVOICE_ROLES.includes(profile.role)) return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('loads')
    .select('load_number, status, customer_name_raw, pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date, commodity, total_miles, rate')
    .eq('carrier_org_id', profile.org_id)
    .order('pickup_date', { ascending: true })

  if (from) query = query.gte('pickup_date', from)
  if (to) query = query.lte('pickup_date', to)

  const { data: loads, error } = await query
  if (error) return apiError('SERVER_ERROR', error.message, 500)

  const rows = (loads ?? []).map((l) => [
    l.load_number, l.status, l.customer_name_raw, l.pickup_city, l.pickup_state, l.pickup_date,
    l.delivery_city, l.delivery_state, l.delivery_date, l.commodity, l.total_miles, l.rate,
  ])

  const totalRevenue = (loads ?? []).reduce((sum, l) => sum + Number(l.rate ?? 0), 0)

  const lines = [
    CSV_HEADER.join(','),
    ...rows.map((row) => row.map(csvField).join(',')),
    '',
    `,,,,,,,,,,Total revenue,${csvField(totalRevenue.toFixed(2))}`,
  ]
  const csv = '﻿' + lines.join('\r\n') // BOM so Excel opens UTF-8 correctly

  const suffix = from || to ? `_${from ?? 'start'}_to_${to ?? 'now'}` : ''
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="loads_export${suffix}.csv"`,
    },
  })
}
