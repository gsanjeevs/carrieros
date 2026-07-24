// app/(app)/customers/[customer_number]/page.tsx
// Customer detail page. Route param is customer_details.customer_number
// ("C-1"-style, auto-assigned by create_customer_org()/org_sequences) rather
// than the numeric organizations.id — same "human-friendly entity number as
// the URL" convention as loads/[load_number], invoices/[invoice_number], and
// vehicles/[vehicle_number].
//
// View roles match customers/page.tsx (the list) and customer_details'
// carrier_customer_select RLS policy — no role restriction there, so anyone
// who can see the directory can open a detail page from it.
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { hasFeature } from '@/lib/entitlements'
import CustomerTabs from './CustomerTabs'
import CustomerContacts from '@/components/CustomerContacts'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import { invoiceStatusVariant, type InvoiceStatus } from '@/lib/domain/invoice-status'
import { Card, CardHeader, CardBody, KpiTile, StatusBadge, Table, TableHeaderCell, TableRow, TableCell, EmptyState } from '@/components/ui'

import { INVOICE_ROLES } from '@/lib/roles-policy'
import { SCORE_CRITICAL, SCORE_WARNING, SUCCESS } from '@/lib/design-tokens'
import { getProfileForUser } from '@/lib/queries/profiles'
import { listLoadsForCustomer } from '@/lib/queries/loads'

const VIEW_ROLES = ['owner', 'solo', 'dispatcher', 'finance']

const SEVERITY_COLOR: Record<string, string> = {
  info:    'bg-blue-500/20 text-blue-400',
  warning: 'bg-amber-500/20 text-amber-400',
  urgent:  'bg-rose-500/20 text-rose-400',
}

function scoreColor(score: number): { stroke: string; text: string } {
  if (score >= 80) return { stroke: SUCCESS, text: 'text-success' }
  if (score >= 50) return { stroke: SCORE_WARNING, text: 'text-amber-500' }
  return { stroke: SCORE_CRITICAL, text: 'text-rose-500' }
}

function HealthScoreRing({ score }: { score: number }) {
  const size = 96
  const stroke = 8
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.min(Math.max(score, 0), 100) / 100)
  const { stroke: strokeColor, text } = scoreColor(score)

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute text-xl font-bold ${text}`}>{Math.round(score)}</span>
    </div>
  )
}

function LockedTeaser({ icon, message }: { icon: string; message: string }) {
  return (
    <Card>
      <EmptyState icon={icon} title={message} />
    </Card>
  )
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-divider-ui last:border-0">
      <span className="text-text-sec text-sm">{label}</span>
      <span className="text-text-pri text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customer_number: string }>
}) {
  const { customer_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('customers')
  const tLoads = await getTranslations('loads')
  const tInvoices = await getTranslations('invoices')
  const locale = await getLocale()

  const { data: customer } = await supabase
    .from('customer_details')
    .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(id, name, email, phone, address, city, state, zip)')
    .eq('customer_number', customer_number)
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (!customer) notFound()
  const org = customer.organizations

  const { data: carrierOrg } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', profile.org_id)
    .maybeSingle()
  const currency = carrierOrg?.currency ?? 'USD'

  const canSeeRevenue = ['owner', 'solo', 'finance'].includes(profile.role)
  const canBill = INVOICE_ROLES.includes(profile.role)

  // Loads for this customer.
  const { data: loadsData } = await listLoadsForCustomer(supabase, org?.id ?? -1, profile.org_id)

  const loads = loadsData ?? []
  const totalRevenue = loads.reduce((sum, l) => sum + Number(l.rate ?? 0), 0)
  const vehiclesUsed = new Set(loads.map((l) => l.vehicle_id).filter(Boolean)).size
  const driversUsed = new Set(loads.map((l) => l.driver_id).filter(Boolean)).size

  // Growth+ entitlements.
  const canSeeHealthScore = await hasFeature(supabase, 'customer_health_score')
  const canSeeExceptions = await hasFeature(supabase, 'exception_history')

  let healthScore: number | null = null
  if (canSeeHealthScore && org?.id) {
    const { data: scoreData, error: scoreError } = await supabase.rpc('get_customer_health_score', {
      customer_org_id: org.id,
    })
    if (scoreError) console.error('[customer detail] get_customer_health_score failed:', scoreError.message)
    healthScore = scoreData != null ? Number(scoreData) : null
  }

  let exceptions: { id: number; event_type: string; severity: string | null; title: string; detail: string | null; occurred_at: string }[] = []
  if (canSeeExceptions && org?.id) {
    const { data: exceptionsData } = await supabase
      .from('exception_events')
      .select('id, event_type, severity, title, detail, occurred_at')
      .eq('entity_type', 'customer')
      .eq('entity_id', org.id)
      .eq('carrier_org_id', profile.org_id)
      .order('occurred_at', { ascending: false })
    exceptions = exceptionsData ?? []
  }

  let invoices: { id: number; invoice_number: string; amount: number; status: string | null; due_date: string | null }[] = []
  if (canBill && org?.id) {
    const { data: invoicesData } = await supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date')
      .eq('customer_org_id', org.id)
      .eq('carrier_org_id', profile.org_id)
      .order('created_at', { ascending: false })
    invoices = invoicesData ?? []
  }

  // Contacts (Phase 3H) — one org, many contacts, some with portal login.
  const canManageContacts = ['owner', 'solo', 'dispatcher'].includes(profile.role)
  const { data: contactsData } = await supabase
    .from('customer_contacts')
    .select('id, name, email, phone, title, is_primary, portal_profile_id')
    .eq('org_id', org?.id ?? -1)
    .eq('carrier_org_id', profile.org_id)
    .order('is_primary', { ascending: false })
    .order('created_at')
  const contacts = contactsData ?? []

  const cityState = [org?.city, org?.state].filter(Boolean).join(', ')
  const addressLine = [org?.address, cityState, org?.zip].filter(Boolean).join(', ')

  const overviewTab = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('detailInfo')}</h2></CardHeader>
          <CardBody>
            <InfoRow label={t('contact')} value={customer.contact_name} />
            <InfoRow label={t('phoneEmail')} value={[org?.phone, org?.email].filter(Boolean).join(' · ') || null} />
            <InfoRow label={t('address')} value={addressLine || null} />
          </CardBody>
        </Card>

        {customer.tags && customer.tags.length > 0 && (
          <Card>
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('tags')}</h2></CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-orange/15 text-brand-orange">
                    {tag}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {customer.notes && (
          <Card>
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('notes')}</h2></CardHeader>
            <CardBody>
              <p className="text-text-sec text-sm whitespace-pre-wrap">{customer.notes}</p>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <div className={`grid ${canSeeRevenue ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          <KpiTile label={t('detailTotalLoads')} value={loads.length} />
          {canSeeRevenue && <KpiTile label={t('detailTotalRevenue')} value={formatMoney(totalRevenue, currency, locale)} />}
          <KpiTile label={t('detailVehiclesUsed')} value={vehiclesUsed} />
          <KpiTile label={t('detailDriversUsed')} value={driversUsed} />
        </div>

        <Card>
          <CardBody className="flex flex-col items-center text-center">
            <h2 className="text-text-pri font-medium text-sm mb-4 self-start">{t('detailHealthScore')}</h2>
            {canSeeHealthScore ? (
              healthScore != null ? (
                <>
                  <HealthScoreRing score={healthScore} />
                  <p className="text-text-mut text-xs mt-3">{t('detailHealthScoreHint')}</p>
                </>
              ) : (
                <p className="text-text-mut text-sm py-4">—</p>
              )
            ) : (
              <div className="w-full">
                <span className="material-symbols-outlined text-text-mut text-3xl">lock</span>
                <p className="text-text-sec text-sm mt-3">{t('detailHealthScoreLocked')}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )

  const loadsTab = loads.length === 0 ? (
    <Card>
      <EmptyState icon="local_shipping" title={t('detailNoLoads')} />
    </Card>
  ) : (
    <Card>
      <Table>
        <thead>
          <tr>
            <TableHeaderCell>{t('detailLoadNumber')}</TableHeaderCell>
            <TableHeaderCell>{t('detailStatus')}</TableHeaderCell>
            <TableHeaderCell>{t('detailRoute')}</TableHeaderCell>
            <TableHeaderCell>{t('detailDate')}</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {loads.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium text-text-pri">
                <Link
                  href={`/loads/${l.load_number}`}
                  className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {l.load_number}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge variant={loadStatusVariant((l.status ?? 'draft') as LoadStatus)}>
                  {tLoads(`status_${l.status ?? 'draft'}` as never)}
                </StatusBadge>
              </TableCell>
              <TableCell>
                {[l.pickup_city, l.pickup_state].filter(Boolean).join(', ') || '—'}
                {' → '}
                {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ') || '—'}
              </TableCell>
              <TableCell>{formatDate(l.pickup_date, profile)}</TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </Card>
  )

  const exceptionsTab = !canSeeExceptions ? (
    <LockedTeaser icon="lock" message={t('detailExceptionsLocked')} />
  ) : exceptions.length === 0 ? (
    <Card>
      <EmptyState icon="check_circle" title={t('detailNoExceptions')} />
    </Card>
  ) : (
    <Card>
      <CardBody>
      <div className="space-y-4">
        {exceptions.map((e) => (
          <div key={e.id} className="flex gap-3">
            <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${e.severity === 'urgent' ? 'bg-rose-400' : e.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-text-pri text-sm font-medium">{e.title}</p>
                {e.severity && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${SEVERITY_COLOR[e.severity] ?? SEVERITY_COLOR.info}`}>
                    {e.severity}
                  </span>
                )}
              </div>
              {e.detail && <p className="text-text-sec text-xs mt-0.5">{e.detail}</p>}
              <p className="text-text-mut text-xs mt-0.5">{formatDate(e.occurred_at, profile)}</p>
            </div>
          </div>
        ))}
      </div>
      </CardBody>
    </Card>
  )

  const invoicesTab = !canBill ? (
    <LockedTeaser icon="lock" message={t('detailInvoicesRestricted')} />
  ) : invoices.length === 0 ? (
    <Card>
      <EmptyState icon="receipt_long" title={t('detailNoInvoices')} />
    </Card>
  ) : (
    <Card>
      <Table>
        <thead>
          <tr>
            <TableHeaderCell>{t('detailInvoiceNumber')}</TableHeaderCell>
            <TableHeaderCell>{t('detailStatus')}</TableHeaderCell>
            <TableHeaderCell>{t('detailDueDate')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('detailAmount')}</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium text-text-pri">
                <Link
                  href={`/invoices/${inv.invoice_number}`}
                  className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {inv.invoice_number}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge variant={invoiceStatusVariant((inv.status ?? 'draft') as InvoiceStatus)}>
                  {tInvoices(`status_${inv.status ?? 'draft'}` as never)}
                </StatusBadge>
              </TableCell>
              <TableCell>{formatDate(inv.due_date, profile)}</TableCell>
              <TableCell numeric className="font-medium text-text-pri">{formatMoney(inv.amount, currency, locale)}</TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </Card>
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/customers" className="text-text-sec hover:text-text-pri transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-2xl font-semibold text-text-pri">{org?.name ?? '—'}</h1>
          <span className="text-text-sec text-sm">{customer.customer_number}</span>
        </div>
      </div>

      <CustomerTabs
        tabs={[
          { key: 'overview', content: overviewTab },
          { key: 'loads', content: loadsTab },
          { key: 'exceptions', content: exceptionsTab },
          { key: 'invoices', content: invoicesTab },
          {
            key: 'contacts',
            content: (
              <CustomerContacts
                orgId={org?.id ?? -1}
                canManage={canManageContacts}
                initialContacts={contacts}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
