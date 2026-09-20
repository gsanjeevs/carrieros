// lib/exceptions.ts
// Shared helper around the get_exceptions() RPC (org-scoped internally via
// my_org_id() — see supabase/schema/schema.sql). Used by both the dedicated
// /exceptions inbox page and the lightweight dashboard banners so the
// tier/icon/color/CTA mapping lives in exactly one place.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getLoadsByIds } from '@/lib/queries/loads'
import { logError } from '@/lib/observability'

export type ExceptionTier = 'today' | 'this_week' | 'upcoming'

export interface ExceptionRow {
  entity_type: string
  entity_id: number
  exception_type: string
  tier: string
  title: string
  detail: string
  due_at: string | null
}

export interface ExceptionItem extends ExceptionRow {
  tier: ExceptionTier
  icon: string
  /** CTA target — undefined when no management UI exists yet for that entity/type. */
  href?: string
}

export const TIER_ORDER: ExceptionTier[] = ['today', 'this_week', 'upcoming']

// Mirrors this app's semantic legend (today=danger, this_week=warning,
// upcoming=info) — see app/globals.css's --color-danger/warning/info, which
// auto-generate the bg-*/text-* utility classes used here.
export const TIER_COLOR: Record<ExceptionTier, string> = {
  today: 'danger',
  this_week: 'warning',
  upcoming: 'info',
}

// exception_type -> Material Symbols icon. Checked against the actual values
// produced by get_exceptions()'s SQL body (schema.sql, search FUNCTION
// get_exceptions): invoice_overdue, doc_expired, doc_expiring, cdl_expiring,
// med_cert_expiring, pod_missing, maintenance_due.
const EXCEPTION_ICON: Record<string, string> = {
  invoice_overdue: 'receipt_long',
  doc_expired: 'description',
  doc_expiring: 'description',
  cdl_expiring: 'badge',
  med_cert_expiring: 'medical_services',
  pod_missing: 'assignment_late',
  maintenance_due: 'build',
}

function iconFor(exceptionType: string): string {
  return EXCEPTION_ICON[exceptionType] ?? 'error'
}

// Sort key: tier (today first) then due_at ascending (most urgent first
// within a tier) — used both for the full grouped inbox and for picking the
// Starter tier's top-3 / dashboard banner's single most-urgent item.
function sortKey(row: ExceptionRow): [number, number] {
  const tierRank = TIER_ORDER.indexOf(row.tier as ExceptionTier)
  const due = row.due_at ? new Date(row.due_at).getTime() : Number.POSITIVE_INFINITY
  return [tierRank === -1 ? TIER_ORDER.length : tierRank, due]
}

export function sortExceptions<T extends ExceptionRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const [aTier, aDue] = sortKey(a)
    const [bTier, bDue] = sortKey(b)
    return aTier !== bTier ? aTier - bTier : aDue - bDue
  })
}

// Fetches get_exceptions() and resolves each row's CTA `href`:
// - invoice_overdue -> /invoices/[invoice_number] (falls back to /invoices
//   if the invoice_number lookup somehow misses)
// - pod_missing -> /loads/[load_number] (same fallback pattern, to /loads)
// - cdl_expiring / med_cert_expiring -> /drivers (the only place those
//   credentials are managed today)
// - maintenance_due -> /maintenance
// - doc_expired / doc_expiring -> no CTA. app/(app)/documents/page.tsx is
//   still a "Coming soon" placeholder, so there's nowhere real to send the
//   user for org/vehicle compliance documents yet.
export async function getExceptions(
  supabase: SupabaseClient<Database>,
  orgId: number | undefined
): Promise<ExceptionItem[]> {
  if (!orgId) return []

  const { data, error } = await supabase.rpc('get_exceptions')
  if (error) {
    logError({ route: 'exceptions' }, error.message, { step: 'get_exceptions failed' })
    return []
  }
  const rows = (data ?? []) as ExceptionRow[]
  if (rows.length === 0) return []

  const invoiceIds = [...new Set(rows.filter((r) => r.exception_type === 'invoice_overdue').map((r) => r.entity_id))]
  const loadIds = [...new Set(rows.filter((r) => r.exception_type === 'pod_missing').map((r) => r.entity_id))]

  const [invoiceRes, loadRes] = await Promise.all([
    invoiceIds.length
      ? supabase.from('invoices').select('id, invoice_number').in('id', invoiceIds)
      : Promise.resolve({ data: [] as { id: number; invoice_number: string }[] }),
    loadIds.length
      ? getLoadsByIds(supabase, loadIds)
      : Promise.resolve({ data: [] as { id: number; load_number: string }[] }),
  ])

  const invoiceNumberById = new Map((invoiceRes.data ?? []).map((i) => [i.id, i.invoice_number]))
  const loadNumberById = new Map((loadRes.data ?? []).map((l) => [l.id, l.load_number]))

  const items: ExceptionItem[] = rows.map((row) => {
    let href: string | undefined
    switch (row.exception_type) {
      case 'invoice_overdue': {
        const num = invoiceNumberById.get(row.entity_id)
        href = num ? `/invoices/${num}` : '/invoices'
        break
      }
      case 'pod_missing': {
        const num = loadNumberById.get(row.entity_id)
        href = num ? `/loads/${num}` : '/loads'
        break
      }
      case 'cdl_expiring':
      case 'med_cert_expiring':
        href = '/drivers'
        break
      case 'maintenance_due':
        href = '/maintenance'
        break
      default:
        href = undefined
    }

    return {
      ...row,
      tier: (TIER_ORDER.includes(row.tier as ExceptionTier) ? row.tier : 'upcoming') as ExceptionTier,
      icon: iconFor(row.exception_type),
      href,
    }
  })

  return sortExceptions(items)
}
