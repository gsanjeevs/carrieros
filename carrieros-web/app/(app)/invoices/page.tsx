// app/(app)/invoices/page.tsx
// Invoice list — owner/solo/finance only (mirrors the `billing_invoices_all`
// RLS policy; drivers and dispatchers get nothing back from the DB either way).
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'

const BILLING_ROLES = ['owner', 'solo', 'finance']
const STATUSES = ['draft', 'sent', 'paid', 'overdue'] as const

const STATUS_COLOR: Record<string, string> = {
  draft:   'bg-slate-500/20 text-slate-400',
  sent:    'bg-blue-500/20 text-blue-400',
  paid:    'bg-[#16a34a]/20 text-[#16a34a]',
  overdue: 'bg-red-500/20 text-red-400',
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; created?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!BILLING_ROLES.includes(profile.role)) redirect('/dashboard')

  const params = await searchParams
  const activeStatus = STATUSES.includes(params.status as typeof STATUSES[number])
    ? params.status
    : undefined

  const t = await getTranslations('invoices')
  const locale = await getLocale()

  const { data: org } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', profile.org_id)
    .maybeSingle()
  const currency = org?.currency ?? 'USD'

  // Opportunistic housekeeping: there's no cron/job scheduler in this project
  // yet, so we flip 'sent' invoices past their due_date to 'overdue' right
  // here, on every load of this page, as a pragmatic stopgap rather than a
  // real scheduled job. mark_overdue_invoices() is scoped to the caller's own
  // org server-side. Replace this with a real schedule (Supabase's pg_cron
  // extension, or a Vercel Cron hitting an API route) once the project has a
  // home for scheduled jobs.
  const { error: overdueError } = await supabase.rpc('mark_overdue_invoices')
  if (overdueError) console.error('[invoices] mark_overdue_invoices failed:', overdueError.message)

  let query = supabase
    .from('invoices')
    .select(`
      id, invoice_number, amount, status, due_date, payment_method, customer_org_id,
      loads ( load_number, customer_name_raw ),
      organizations!invoices_customer_org_id_fkey ( name )
    `)
    .eq('carrier_org_id', profile.org_id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (activeStatus) query = query.eq('status', activeStatus)

  const { data: invoices, error } = await query
  if (error) console.error('[invoices] list query failed:', error.message)

  const total = (invoices ?? []).reduce((sum, i) => sum + Number(i.amount ?? 0), 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('invoiceCount', { count: invoices?.length ?? 0 })}
            {invoices && invoices.length > 0 && (
              <> · {t('totalValue', { amount: formatMoney(total, currency, locale) })}</>
            )}
          </p>
        </div>
      </div>

      {params.created && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('createdSuccess', { invoiceNumber: params.created })}</p>
        </div>
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-5">
        <FilterChip href="/invoices" label={t('filterAll')} active={!activeStatus} />
        {STATUSES.map((s) => (
          <FilterChip
            key={s}
            href={`/invoices?status=${s}`}
            label={t(`status_${s}`)}
            active={activeStatus === s}
          />
        ))}
      </div>

      {!invoices || invoices.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center">
          <span className="material-symbols-outlined text-slate-600 text-4xl">receipt_long</span>
          <p className="text-slate-500 text-sm mt-3">
            {activeStatus ? t('noInvoicesForFilter') : t('noInvoicesYet')}
          </p>
          <p className="text-slate-600 text-xs mt-2">{t('createFromLoadHint')}</p>
          <Link
            href="/loads"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[16px]">local_shipping</span>
            {t('goToLoads')}
          </Link>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <Th>{t('invoiceNumber')}</Th>
                <Th>{t('customer')}</Th>
                <Th>{t('load')}</Th>
                <Th>{t('status')}</Th>
                <Th>{t('dueDate')}</Th>
                <Th>{t('paymentMethod')}</Th>
                <Th align="right">{t('amount')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/invoices/${inv.invoice_number}`}
                      className="text-white font-medium hover:text-[#f97316] transition-colors"
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-slate-300 max-w-[180px] truncate">
                    {inv.organizations?.name ?? inv.loads?.customer_name_raw ?? '—'}
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">
                    {inv.loads?.load_number ? (
                      <Link
                        href={`/loads/${inv.loads.load_number}`}
                        className="hover:text-[#f97316] transition-colors"
                      >
                        {inv.loads.load_number}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[inv.status ?? 'draft'] ?? STATUS_COLOR.draft}`}>
                      {t(`status_${inv.status ?? 'draft'}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">{formatDate(inv.due_date, profile)}</td>
                  <td className="px-4 py-3.5 text-slate-400">{t(`method_${inv.payment_method}`)}</td>
                  <td className="px-5 py-3.5 text-right text-white font-medium">
                    {formatMoney(inv.amount, currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`${align === 'right' ? 'text-right px-5' : 'text-left px-4'} py-3 text-xs font-medium text-slate-500 uppercase tracking-wide first:px-5`}>
      {children}
    </th>
  )
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        active
          ? 'bg-[#f97316]/15 text-[#f97316] border border-[#f97316]/30'
          : 'bg-white/5 text-slate-400 border border-white/8 hover:text-white hover:bg-white/10'
      }`}
    >
      {label}
    </Link>
  )
}
