// app/(app)/invoices/[invoice_number]/print/page.tsx
// Print / "Download PDF" (docs/feature-completeness-audit.md's #3 gap).
// Deliberately does NOT add a PDF-generation library — a clean print-only
// layout + the browser's own Print dialog (destination: "Save as PDF")
// is a real, fully-working download-a-PDF capability with zero new
// dependencies, consistent with this project's preference for small,
// honest implementations over speculative infrastructure. See
// PrintButton.tsx for the one bit of client interactivity this needs.
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { INVOICE_ROLES } from '@/lib/roles-policy'
import PrintButton from './PrintButton'
import { getProfileForUser } from '@/lib/queries/profiles'

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ invoice_number: string }>
}) {
  const { invoice_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!INVOICE_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('invoices')
  const locale = await getLocale()

  const { data: invoice } = await supabase
    .from('invoices')
    .select(`
      *,
      loads ( load_number, commodity, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw ),
      organizations!invoices_customer_org_id_fkey ( name, address, city, state, zip )
    `)
    .eq('invoice_number', decodeURIComponent(invoice_number))
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (!invoice) notFound()

  const { data: org } = await supabase
    .from('organizations')
    .select('name, email, phone, address, city, state, zip, currency')
    .eq('id', profile.org_id)
    .maybeSingle()
  const currency = org?.currency ?? 'USD'

  const customerName = invoice.organizations?.name ?? invoice.loads?.customer_name_raw ?? '—'
  const customerAddress = [invoice.organizations?.address, invoice.organizations?.city, invoice.organizations?.state, invoice.organizations?.zip]
    .filter(Boolean).join(', ')
  const carrierAddress = [org?.address, org?.city, org?.state, org?.zip].filter(Boolean).join(', ')
  const route = invoice.loads
    ? [invoice.loads.pickup_city, invoice.loads.pickup_state].filter(Boolean).join(', ') +
      ' → ' +
      [invoice.loads.delivery_city, invoice.loads.delivery_state].filter(Boolean).join(', ')
    : null

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <div className="max-w-2xl mx-auto p-10 print:p-0">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <a href={`/invoices/${invoice.invoice_number}`} className="text-slate-500 text-sm hover:text-slate-900">
            ← {t('backToInvoice')}
          </a>
          <PrintButton label={t('printDownload')} />
        </div>

        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-2xl font-bold">{org?.name ?? '—'}</h1>
            {carrierAddress && <p className="text-sm text-slate-500 mt-1">{carrierAddress}</p>}
            {org?.email && <p className="text-sm text-slate-500">{org.email}</p>}
            {org?.phone && <p className="text-sm text-slate-500">{org.phone}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-xl font-semibold uppercase tracking-wide text-slate-700">{t('invoice')}</h2>
            <p className="text-sm text-slate-500 mt-1">{invoice.invoice_number}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-10">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('billTo')}</p>
            <p className="text-sm font-medium">{customerName}</p>
            {customerAddress && <p className="text-sm text-slate-500">{customerAddress}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('issued')}</p>
            <p className="text-sm">{formatDate(invoice.created_at, profile)}</p>
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1 mt-3">{t('dueDate')}</p>
            <p className="text-sm">{formatDate(invoice.due_date, profile)}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-8">
          <thead>
            <tr className="border-b-2 border-slate-900">
              <th className="text-left py-2 font-semibold">{t('description')}</th>
              <th className="text-right py-2 font-semibold">{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-3">
                {invoice.loads?.load_number
                  ? t('lineItemLinehaul', { loadNumber: invoice.loads.load_number, route: route ?? '—' })
                  : t('lineItemGeneric')}
                {invoice.loads?.commodity && <span className="block text-slate-500 text-xs mt-0.5">{invoice.loads.commodity}</span>}
              </td>
              <td className="py-3 text-right">{formatMoney(invoice.amount, currency, locale)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="py-3 font-semibold text-right" colSpan={1}>{t('total')}</td>
              <td className="py-3 text-right font-bold text-lg">{formatMoney(invoice.amount, currency, locale)}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.notes && (
          <div className="mb-8">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('notes')}</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        <p className="text-xs text-slate-400 mt-16 pt-4 border-t border-slate-200">CarrierOS</p>
      </div>
    </div>
  )
}
