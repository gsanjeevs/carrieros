// app/api/customers/bulk-import/route.ts
// Bulk customer import (PRD: CSV/XLS import, preview-then-confirm, max 50
// rows). The client already parsed the CSV and resolved per-row
// create/skip/overwrite decisions in the preview step — this route just
// forwards the decided rows to the bulk_import_customers() RPC, which does
// the atomic multi-row insert/update and re-checks duplicates server-side
// as a safety net (see schema.sql comment on that function).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import type { Json } from '@/types/supabase'

interface ImportRow {
  name: string
  contact_name?: string
  phone?: string
  email?: string
  action?: 'create' | 'skip' | 'overwrite'
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase } = ctx

  const body = await request.json()
  const rows = body.rows as ImportRow[] | undefined

  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50)
    return apiError('VALIDATION_ERROR', 'rows must be a non-empty array of at most 50', 400)

  const { data, error } = await supabase.rpc('bulk_import_customers', { p_rows: rows as unknown as Json })

  if (error) {
    if (error.message.includes('NO_ORGANIZATION'))
      return apiError('NOT_ONBOARDED', error.message, 400)
    if (error.message.includes('FORBIDDEN'))
      return apiError('FORBIDDEN', error.message, 403)
    if (error.message.includes('VALIDATION_ERROR'))
      return apiError('VALIDATION_ERROR', error.message, 400)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  const results = (data ?? []).map((r: { row_name: string; row_action: string; customer_number: string | null; org_id: number | null }) => ({
    name: r.row_name,
    action: r.row_action,
    customerNumber: r.customer_number,
    orgId: r.org_id,
  }))

  return NextResponse.json({ results })
}
