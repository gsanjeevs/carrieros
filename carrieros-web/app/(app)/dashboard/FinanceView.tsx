// app/(app)/dashboard/FinanceView.tsx
// Finance emphasis: Revenue MTD, Outstanding Invoices with a real aging
// breakdown (bucketed by days past due_date), and Avg Rate/Load. No fleet
// or driver-compliance content — finance doesn't manage the fleet.
import { createClient } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'

export default async function FinanceView({ orgId }: { orgId: number | undefined }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const locale = await getLocale()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [revenueRes, outstandingRes, ratesRes] = await Promise.all([
    orgId
      ? supabase
          .from('invoices')
          .select('amount')
          .eq('carrier_org_id', orgId)
          .eq('status', 'paid')
          .gte('paid_at', startOfMonth.toISOString())
          .lt('paid_at', startOfNextMonth.toISOString())
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase
          .from('invoices')
          .select('amount, due_date')
          .eq('carrier_org_id', orgId)
          .in('status', ['sent', 'overdue'])
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase
          .from('loads')
          .select('rate')
          .eq('carrier_org_id', orgId)
          .neq('status', 'cancelled')
          .not('rate', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const revenueMtd = (revenueRes.data ?? []).reduce(
    (sum: number, inv: { amount: number | string | null }) => sum + Number(inv.amount ?? 0), 0
  )

  const outstandingInvoices = (outstandingRes.data ?? []) as { amount: number | string | null; due_date: string | null }[]
  const outstandingAmount = outstandingInvoices.reduce(
    (sum: number, inv) => sum + Number(inv.amount ?? 0), 0
  )

  const rateRows = (ratesRes.data ?? []) as { rate: number | string | null }[]
  const avgRate = rateRows.length
    ? rateRows.reduce((sum: number, l) => sum + Number(l.rate ?? 0), 0) / rateRows.length
    : 0

  // Invoice aging: bucket outstanding invoices by how many days past
  // due_date they are. Invoices with no due_date are treated as "current".
  const buckets = { current: 0, days30: 0, days60: 0, days90: 0 }
  const bucketCounts = { current: 0, days30: 0, days60: 0, days90: 0 }
  let oldestDueDate: string | null = null
  for (const inv of outstandingInvoices) {
    const amount = Number(inv.amount ?? 0)
    let daysPastDue = -1
    if (inv.due_date) {
      daysPastDue = Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / (24 * 60 * 60 * 1000))
      if (!oldestDueDate || new Date(inv.due_date) < new Date(oldestDueDate)) oldestDueDate = inv.due_date
    }
    if (daysPastDue >= 90) { buckets.days90 += amount; bucketCounts.days90++ }
    else if (daysPastDue >= 60) { buckets.days60 += amount; bucketCounts.days60++ }
    else if (daysPastDue >= 30) { buckets.days30 += amount; bucketCounts.days30++ }
    else { buckets.current += amount; bucketCounts.current++ }
  }

  const agingRows: { label: string; amount: number; count: number; color: string }[] = [
    { label: t('agingCurrent'), amount: buckets.current, count: bucketCounts.current, color: '#16a34a' },
    { label: t('aging30'), amount: buckets.days30, count: bucketCounts.days30, color: '#d97706' },
    { label: t('aging60'), amount: buckets.days60, count: bucketCounts.days60, color: '#f97316' },
    { label: t('aging90'), amount: buckets.days90, count: bucketCounts.days90, color: '#dc2626' },
  ]

  return (
    <div className="p-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <div className="flex items-start justify-between mb-3">
            <span className="text-slate-400 text-sm font-medium">{t('revenueThisMonth')}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#16a34a20' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#16a34a' }}>payments</span>
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white tracking-tight">{formatMoney(revenueMtd, 'USD', locale)}</p>
          <p className="text-slate-500 text-xs mt-1">{t('revenueThisMonthSub')}</p>
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <div className="flex items-start justify-between mb-3">
            <span className="text-slate-400 text-sm font-medium">{t('outstandingInvoices')}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#d9770620' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#d97706' }}>receipt_long</span>
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white tracking-tight">{formatMoney(outstandingAmount, 'USD', locale)}</p>
          <p className="text-slate-500 text-xs mt-1">{t('outstandingInvoicesSub', { count: outstandingInvoices.length })}</p>
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <div className="flex items-start justify-between mb-3">
            <span className="text-slate-400 text-sm font-medium">{t('avgRatePerLoad')}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#3b82f620' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#3b82f6' }}>trending_up</span>
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white tracking-tight">{formatMoney(avgRate, 'USD', locale)}</p>
          <p className="text-slate-500 text-xs mt-1">{t('avgRatePerLoadSub', { count: rateRows.length })}</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl shadow-card-dark">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">{t('invoiceAging')}</h2>
          {oldestDueDate && (
            <span className="text-slate-500 text-xs">
              {t('agingOldest', { date: new Date(oldestDueDate).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) })}
            </span>
          )}
        </div>
        {outstandingInvoices.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-slate-600 text-4xl">receipt_long</span>
            <p className="text-slate-500 text-sm mt-3">{t('agingNoneOutstanding')}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {agingRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="text-slate-300 text-sm">{row.label}</span>
                  <span className="text-slate-500 text-xs">({row.count})</span>
                </div>
                <span className="text-white text-sm font-medium">{formatMoney(row.amount, 'USD', locale)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
