// app/(app)/invoices/[invoice_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate, formatDateTime } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import InvoiceActions from '../InvoiceActions'

const BILLING_ROLES = ['owner', 'solo', 'finance']

const STATUS_COLOR: Record<string, string> = {
  draft:   'bg-slate-500/20 text-slate-400',
  sent:    'bg-blue-500/20 text-blue-400',
  paid:    'bg-[#16a34a]/20 text-[#16a34a]',
  overdue: 'bg-red-500/20 text-red-400',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="text-white text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoice_number: string }>
}) {
  const { invoice_number } = await params
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

  const t = await getTranslations('invoices')
  const locale = await getLocale()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      *,
      loads (
        id, load_number, commodity, total_miles, rate,
        pickup_city, pickup_state, delivery_city, delivery_state,
        pickup_date, delivery_date, customer_name_raw
      ),
      organizations!invoices_customer_org_id_fkey ( name, address, city, state, zip )
    `)
    .eq('invoice_number', decodeURIComponent(invoice_number))
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (error) console.error('[invoices] detail query failed:', error.message)
  if (!invoice) notFound()

  const { data: org } = await supabase
    .from('organizations')
    .select('name, currency')
    .eq('id', profile.org_id)
    .maybeSingle()
  const currency = org?.currency ?? 'USD'

  const { data: carrier } = await supabase
    .from('carrier_details')
    .select('factoring_company')
    .eq('org_id', profile.org_id)
    .maybeSingle()

  const customerName =
    invoice.organizations?.name ?? invoice.loads?.customer_name_raw ?? null
  const route = invoice.loads
    ? [invoice.loads.pickup_city, invoice.loads.pickup_state].filter(Boolean).join(', ') +
      ' → ' +
      [invoice.loads.delivery_city, invoice.loads.delivery_state].filter(Boolean).join(', ')
    : null

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/invoices" className="text-slate-500 hover:text-white transition">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>
            <h1 className="text-2xl font-semibold text-white">{invoice.invoice_number}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[invoice.status ?? 'draft'] ?? STATUS_COLOR.draft}`}>
              {t(`status_${invoice.status ?? 'draft'}`)}
            </span>
          </div>
          <p className="text-slate-400 text-sm ml-9">
            {t('billedTo', { customer: customerName ?? '—' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t('amountDue')}</p>
          <p className="text-2xl font-semibold text-white">{formatMoney(invoice.amount, currency, locale)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: summary + line items */}
        <div className="lg:col-span-2 space-y-6">

          <div className="bg-white/5 border border-white/8 rounded-xl p-5">
            <h2 className="text-white font-medium text-sm mb-3">{t('summary')}</h2>
            <InfoRow label={t('from')} value={org?.name ?? '—'} />
            <InfoRow label={t('customer')} value={customerName ?? '—'} />
            <InfoRow
              label={t('load')}
              value={
                invoice.loads?.load_number ? (
                  <Link href={`/loads/${invoice.loads.load_number}`} className="text-[#f97316] hover:underline">
                    {invoice.loads.load_number}
                  </Link>
                ) : '—'
              }
            />
            <InfoRow label={t('route')} value={route ?? '—'} />
            <InfoRow label={t('issued')} value={formatDate(invoice.created_at, profile)} />
            <InfoRow label={t('dueDate')} value={formatDate(invoice.due_date, profile)} />
            <InfoRow
              label={t('sentAt')}
              value={invoice.sent_at ? formatDateTime(invoice.sent_at, profile) : t('notSentYet')}
            />
            <InfoRow
              label={t('paidAt')}
              value={invoice.paid_at ? formatDateTime(invoice.paid_at, profile) : t('notPaidYet')}
            />
          </div>

          {/* Line items */}
          <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden">
            <h2 className="text-white font-medium text-sm px-5 pt-5 pb-3">{t('lineItems')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('description')}</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="px-5 py-3.5 text-slate-300">
                    {invoice.loads?.load_number
                      ? t('lineItemLinehaul', {
                          loadNumber: invoice.loads.load_number,
                          route: route ?? '—',
                        })
                      : t('lineItemGeneric')}
                    {invoice.loads?.commodity && (
                      <span className="block text-slate-500 text-xs mt-0.5">{invoice.loads.commodity}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right text-white">
                    {formatMoney(invoice.amount, currency, locale)}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3.5 text-white font-medium">{t('total')}</td>
                  <td className="px-5 py-3.5 text-right text-white font-semibold">
                    {formatMoney(invoice.amount, currency, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {invoice.notes && (
            <div className="bg-white/5 border border-white/8 rounded-xl p-5">
              <h2 className="text-white font-medium text-sm mb-2">{t('notes')}</h2>
              <p className="text-slate-400 text-sm whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="space-y-6">
          <InvoiceActions
            invoiceId={invoice.id}
            status={invoice.status ?? 'draft'}
            paymentMethod={invoice.payment_method}
            factoringCompany={invoice.factoring_company}
            factoringReference={invoice.factoring_reference}
            factoredAtLabel={
              invoice.factored_at ? formatDateTime(invoice.factored_at, profile) : null
            }
            defaultFactoringCompany={carrier?.factoring_company ?? ''}
          />
        </div>
      </div>
    </div>
  )
}
