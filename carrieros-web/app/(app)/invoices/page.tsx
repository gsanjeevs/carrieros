// app/(app)/invoices/page.tsx
// Invoice list — owner/solo/finance only (mirrors the `billing_invoices_all`
// RLS policy; drivers and dispatchers get nothing back from the DB either way).
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { INVOICE_ROLES } from '@/lib/roles-policy'
import { invoiceStatusVariant, type InvoiceStatus } from '@/lib/domain/invoice-status'
import { Card, EmptyState, StatusBadge, Table, TableHeaderCell, TableRow, TableCell } from '@/components/ui'

const STATUSES = ['draft', 'sent', 'paid', 'overdue'] as const

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
  if (!INVOICE_ROLES.includes(profile.role)) redirect('/dashboard')

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
        <Card>
          <EmptyState
            icon="receipt_long"
            title={activeStatus ? t('noInvoicesForFilter') : t('noInvoicesYet')}
            description={t('createFromLoadHint')}
          />
          <div className="flex justify-center pb-8 -mt-2">
            <Link
              href="/loads"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
            >
              <span className="material-symbols-outlined text-[16px]">local_shipping</span>
              {t('goToLoads')}
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('invoiceNumber')}</TableHeaderCell>
                <TableHeaderCell>{t('customer')}</TableHeaderCell>
                <TableHeaderCell>{t('load')}</TableHeaderCell>
                <TableHeaderCell>{t('status')}</TableHeaderCell>
                <TableHeaderCell>{t('dueDate')}</TableHeaderCell>
                <TableHeaderCell>{t('paymentMethod')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('amount')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.invoice_number}`}
                      className="text-text-pri font-medium hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                    >
                      {inv.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {inv.organizations?.name ?? inv.loads?.customer_name_raw ?? '—'}
                  </TableCell>
                  <TableCell>
                    {inv.loads?.load_number ? (
                      <Link
                        href={`/loads/${inv.loads.load_number}`}
                        className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                      >
                        {inv.loads.load_number}
                      </Link>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={invoiceStatusVariant((inv.status ?? 'draft') as InvoiceStatus)}>
                      {t(`status_${inv.status ?? 'draft'}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{formatDate(inv.due_date, profile)}</TableCell>
                  <TableCell>{t(`method_${inv.payment_method}`)}</TableCell>
                  <TableCell numeric className="font-medium">
                    {formatMoney(inv.amount, currency, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
        active
          ? 'bg-[#f97316]/15 text-[#f97316] border border-[#f97316]/30'
          : 'bg-surface-card text-text-sec border border-border-ui hover:text-text-pri hover:bg-surface-subtle'
      }`}
    >
      {label}
    </Link>
  )
}
