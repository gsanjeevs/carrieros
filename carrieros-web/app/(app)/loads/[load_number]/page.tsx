// app/(app)/loads/[load_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchPanel from '@/components/DispatchPanel'
import LoadActionGrid from '@/components/LoadActionGrid'
import LoadDocuments, { type DocType, type LoadDocument } from '@/components/LoadDocuments'
import SendDocumentsButton from '@/components/SendDocumentsButton'
import DriverMessageThread from '@/components/DriverMessageThread'
import IftaCrossingsSection, { type IftaCrossingRow } from '@/components/IftaCrossingsSection'
import { hasFeature } from '@/lib/entitlements'
import { formatDateTime, toDate } from '@/lib/format-datetime'
import { formatMoney, resolveCurrency } from '@/lib/format-money'
import CreateInvoiceButton from './CreateInvoiceButton'
import PostToDatButton from './PostToDatButton'
import DriverLoadActions from './DriverLoadActions'
import DvirForm from './DvirForm'
import LoadFuelStops from './LoadFuelStops'
import LoadOrdersSection from './LoadOrdersSection'
import CustomerExceptionControls from './CustomerExceptionControls'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import { Card, CardHeader, CardBody, StatusBadge, PageBackLink } from '@/components/ui'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { createLoadboardPostingService } from '@/server/composition'
import { resolveFromLabel } from '@/lib/resolve-from-label'

const STATUS_FLOW_KEYS = [
  { key: 'draft',      icon: 'draft' },
  { key: 'scheduled',  icon: 'event' },
  { key: 'dispatched', icon: 'send' },
  { key: 'picked_up',  icon: 'inventory_2' },
  { key: 'in_transit', icon: 'local_shipping' },
  { key: 'delivered',  icon: 'where_to_vote' },
  { key: 'invoiced',   icon: 'receipt' },
  { key: 'paid',       icon: 'paid' },
]

function fmt(date: string | null, locale: string) {
  if (!date) return '—'
  return toDate(date).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-divider-ui last:border-0">
      <span className="text-text-sec text-sm">{label}</span>
      <span className="text-text-pri text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function LoadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ load_number: string }>
  searchParams: Promise<{ from?: string; fromLabel?: string }>
}) {
  const { load_number } = await params
  const { from, fromLabel: fromLabelKey } = await searchParams
  const fromLabel = await resolveFromLabel(fromLabelKey)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('loads')
  const now = new Date()
  const locale = await getLocale()

  const STATUS_FLOW = STATUS_FLOW_KEYS.map((s) => ({ ...s, label: t(`status_${s.key}`) }))

  // Fetch load
  const { data: load } = await supabase
    .from('loads')
    .select(`
      *,
      drivers ( id, driver_number, profile_id, profiles ( first_name, last_name ) ),
      vehicles ( id, vehicle_number, nickname, make, model, year )
    `)
    .eq('load_number', load_number)
    .eq('carrier_org_id', profile.org_id)
    .single()

  if (!load) notFound()

  // Fetch customer name/email if linked
  let customerName: string | null = null
  let customerEmail: string | null = null
  if (load.customer_org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, email')
      .eq('id', load.customer_org_id)
      .single()
    customerName = org?.name ?? null
    customerEmail = org?.email ?? null
  }

  // Fetch load events
  const { data: events } = await supabase
    .from('load_events')
    .select('id, event_type, note, created_at, profiles(first_name, last_name)')
    .eq('load_id', load.id)
    .order('created_at', { ascending: true })

  // Documents — RLS scopes these to the caller's org (carrier_docs_select).
  const { data: docRows } = await supabase
    .from('documents')
    .select('id, type, storage_path, created_at, profiles(first_name, last_name)')
    .eq('load_id', load.id)
    .order('created_at', { ascending: false })

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'webp']
  const documents: LoadDocument[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      const fileName = d.storage_path.split('/').pop() ?? d.storage_path
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      // Bucket is PRIVATE — thumbnails and links both need a signed URL.
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(d.storage_path, 60 * 60)
      return {
        id: d.id,
        type: (d.type ?? 'other') as DocType,
        storagePath: d.storage_path,
        fileName: fileName.replace(/^\d{10,}-/, ''),
        isImage: IMAGE_EXT.includes(ext),
        signedUrl: signed?.signedUrl ?? null,
        createdAtLabel: formatDateTime(d.created_at, profile),
        uploaderName: d.profiles
          ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ') || null
          : null,
      }
    })
  )

  // Billing — `invoice_actions` (owner/solo/finance), the same capability the
  // invoice routes gate on and the same roles as the `billing_invoices_all`
  // RLS policy; for anyone else this query returns nothing anyway.
  const canBill = roleHasCapability(profile.role, 'invoice_actions')
  let existingInvoices: Array<{ invoice_number: string; customer_org_id: number | null; customer_name: string | null }> = []
  if (canBill) {
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, customer_org_id, organizations!invoices_customer_org_id_fkey(name)')
      .eq('load_id', load.id)
      .order('created_at', { ascending: true })
    existingInvoices = (data ?? []).map((invoice) => {
      const customer = Array.isArray(invoice.organizations) ? invoice.organizations[0] : invoice.organizations
      return { invoice_number: invoice.invoice_number, customer_org_id: invoice.customer_org_id, customer_name: customer?.name ?? null }
    })
  }
  const billable = canBill && ['delivered', 'invoiced'].includes(load.status ?? '')

  const { data: carrierOrg } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', profile.org_id)
    .maybeSingle()

  // Rate visibility is money-visibility, not a named capability: no
  // role_capabilities row means "may see the rate", so this stays explicit.
  const showRate    = roleHasCapability(profile.role, 'rate_visibility')
  const canDispatch = roleHasCapability(profile.role, 'loads_manage')
  const [orderQuery, customerQuery] = await Promise.all([
    canBill
      ? supabase.from('load_orders').select('id, order_number, customer_reference, commodity, weight_lbs, customer_org_id, billable_amount').eq('load_id', load.id).order('created_at', { ascending: true })
      : supabase.from('load_orders').select('id, order_number, customer_reference, commodity, weight_lbs, customer_org_id').eq('load_id', load.id).order('created_at', { ascending: true }),
    canDispatch
      ? supabase.from('customer_details').select('org_id, organizations!customer_details_org_id_fkey(name)').eq('carrier_org_id', profile.org_id)
      : Promise.resolve({ data: [] }),
  ])
  const orderRows = (orderQuery.data ?? []) as unknown as Array<{
    id: number; order_number: string; customer_reference: string | null; commodity: string | null;
    weight_lbs: number | null; customer_org_id: number; billable_amount?: number | null;
  }>
  const customerRows = customerQuery.data ?? []
  const orderCustomerIds = [...new Set(orderRows.map((order) => order.customer_org_id))]
  const { data: orderCustomerOrgs } = orderCustomerIds.length
    ? await supabase.from('organizations').select('id, name').in('id', orderCustomerIds)
    : { data: [] }
  const orderCustomerNames = new Map((orderCustomerOrgs ?? []).map((org) => [org.id, org.name]))
  const loadOrders = orderRows.map((order) => ({
    ...order,
    billable_amount: canBill ? order.billable_amount ?? null : null,
    customer_name: orderCustomerNames.get(order.customer_org_id) ?? t('customer'),
  }))
  const orderCustomers = (customerRows ?? []).map((customer) => ({
    id: customer.org_id,
    name: customer.organizations?.name ?? t('customer'),
  }))
  const { data: customerExceptionRows } = canDispatch && load.tracking_token
    ? await supabase.from('exception_events')
      .select('id, title, detail, severity, occurred_at, customer_visible, customer_message')
      .eq('carrier_org_id', profile.org_id)
      .eq('entity_type', 'load')
      .eq('entity_id', load.id)
      .order('occurred_at', { ascending: false })
    : { data: [] }
  // Upload/delete stay explicit: `documents_upload` also includes the driver
  // (who uploads from the truck), and no capability covers deleting a
  // document — converting either would widen access.
  const canUploadDoc = roleHasCapability(profile.role, 'documents_upload')
  const canDeleteDoc = roleHasCapability(profile.role, 'documents_delete')
  // Driver chat (audit gap #13): finance gets none of it, by design (BR-2/
  // FR-119) — `chat_participate` is the same role set the API routes' own
  // explicit access checks use.
  const canChat = roleHasCapability(profile.role, 'chat_participate')
  const chatEntitled = canChat && (await hasFeature(supabase, 'driver_chat'))

  // IFTA mileage log (audit gap #13 cluster): `ifta_record` — owner/solo/
  // dispatcher manage; driver logs their own via RLS.
  const canIfta = roleHasCapability(profile.role, 'ifta_record')
  const iftaEntitled = canIfta && (await hasFeature(supabase, 'ifta_mileage_log'))
  let iftaCrossings: IftaCrossingRow[] = []
  if (iftaEntitled) {
    const { data: crossingsData } = await supabase
      .from('ifta_state_crossings')
      .select('id, state, crossed_at, odometer_est')
      .eq('load_id', load.id)
      .order('crossed_at', { ascending: true })
    iftaCrossings = (crossingsData ?? []).map((c) => ({
      id: c.id,
      state: c.state,
      crossedAt: c.crossed_at,
      odometerEst: c.odometer_est,
    }))
  }

  // DAT load board (Phase 1, posting only, migration 0052): `loadboard_posting` — owner/solo/
  // dispatcher, Growth+. Uses the same in-process application service (server/composition.ts) the
  // API routes use, per ADR 0003, rather than a raw .from('loadboard_postings') query.
  const canLoadboard = roleHasCapability(profile.role, 'loadboard_posting')
  let loadboardEntitled = false
  let existingDatPosting: { externalPostingId: string; postedAt: string } | null = null
  if (canLoadboard) {
    const actor = await buildActorContext(supabase, user, crypto.randomUUID())
    if (actor.ok) {
      const status = await createLoadboardPostingService(supabase).getPostingStatus(actor.value, load.id)
      if (status.ok) {
        loadboardEntitled = true
        existingDatPosting = status.value ? { externalPostingId: status.value.externalPostingId, postedAt: status.value.postedAt } : null
      }
      // status.ok === false with ENTITLEMENT_REQUIRED just means the org isn't Growth+ yet —
      // loadboardEntitled stays false and PostToDatButton renders nothing, same
      // "gated but not entitled" posture as dispatch/page.tsx's hasFeature check.
    }
  }

  const isCancelled = load.status === 'cancelled'
  const isDeclined  = load.status === 'declined'
  const currentIdx  = STATUS_FLOW.findIndex(s => s.key === load.status)
  const TERMINAL_STATUSES = ['delivered', 'invoiced', 'paid', 'cancelled', 'declined']
  const canCancelLoad = !TERMINAL_STATUSES.includes(load.status ?? 'draft')
  const driverName  = load.drivers?.profiles
    ? [load.drivers.profiles.first_name, load.drivers.profiles.last_name].filter(Boolean).join(' ')
    : null
  const vehicleLabel  = load.vehicles
    ? `${load.vehicles.vehicle_number ?? ''} ${load.vehicles.nickname}`.trim()
    : null

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <PageBackLink from={from} fromLabel={fromLabel} defaultHref="/loads" defaultLabel={t('backToLoads')} className="mb-3" />
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-semibold text-text-pri">{load.load_number}</h1>
          <StatusBadge variant={loadStatusVariant((load.status ?? 'draft') as LoadStatus)}>
            {load.status ? t(`status_${load.status}` as never) : t('status_draft' as never)}
          </StatusBadge>
        </div>

        {/* Route strip */}
        <div className="flex items-center gap-3 ml-9">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-brand-orange shrink-0" />
            <span className="text-text-pri text-sm font-medium truncate">
              {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
          <div className="flex-1 h-px bg-divider-ui min-w-[24px] max-w-[80px]" />
          <span className="material-symbols-outlined text-text-mut text-[16px] -mx-1 shrink-0">arrow_forward</span>
          <div className="flex-1 h-px bg-divider-ui min-w-[24px] max-w-[80px]" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-teal shrink-0" />
            <span className="text-text-pri text-sm font-medium truncate">
              {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Hero rate card */}
      {showRate && (
        <Card className="mb-6">
          <CardBody className="flex flex-col items-center text-center">
            <p className="text-[11px] uppercase tracking-wider text-text-sec font-semibold mb-1">{t('rateHero')}</p>
            <p className="text-4xl font-extrabold text-brand-orange">
              {load.rate != null ? formatMoney(load.rate, resolveCurrency(carrierOrg?.currency), locale) : '—'}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Action grid */}
      <div className="mb-6">
        <LoadActionGrid trackingToken={load.tracking_token ?? null} loadNumber={load.load_number} canCancel={canCancelLoad} />
      </div>
      {canDispatch && load.tracking_token && (customerExceptionRows?.length ?? 0) > 0 && (
        <div className="mb-6">
          <CustomerExceptionControls loadId={load.id} exceptions={customerExceptionRows ?? []} />
        </div>
      )}

      {/* Status timeline */}
      <Card className="mb-6">
        <CardBody>
        <div className={`flex items-center gap-0 overflow-x-auto ${(isCancelled || isDeclined) ? 'opacity-40 grayscale' : ''}`}>
          {STATUS_FLOW.map((s, i) => {
            const done    = !isCancelled && !isDeclined && i < currentIdx
            const current = !isCancelled && !isDeclined && i === currentIdx
            return (
              <div key={s.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                    current ? 'bg-brand-orange ring-2 ring-brand-orange/30' :
                    done    ? 'bg-brand-orange/20' : 'bg-surface-subtle'
                  }`}>
                    <span className={`material-symbols-outlined text-[16px] ${
                      current ? 'text-brand-on-primary' : done ? 'text-brand-orange' : 'text-text-mut'
                    }`}>{s.icon}</span>
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${
                    current ? 'text-brand-orange' : done ? 'text-text-sec' : 'text-text-mut'
                  }`}>{s.label}</span>
                </div>
                {i < STATUS_FLOW.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${done ? 'bg-brand-orange/40' : 'bg-divider-ui'}`} />
                )}
              </div>
            )
          })}
        </div>
        {isCancelled && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-divider-ui">
            <span className="material-symbols-outlined text-[18px] text-status-danger">cancel</span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-status-danger-surface text-status-danger">
              {t('cancelledEndState')}
            </span>
          </div>
        )}
        {isDeclined && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-divider-ui">
            <span className="material-symbols-outlined text-[18px] text-status-danger">block</span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-status-danger-surface text-status-danger">
              {t('declinedEndState')}
            </span>
          </div>
        )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Load details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Route */}
          <Card>
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('route')}</h2></CardHeader>
            <CardBody>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-brand-orange font-semibold mb-2">{t('pickup')}</p>
                <p className="text-text-pri text-sm font-medium">{load.pickup_address ?? '—'}</p>
                <p className="text-text-sec text-sm">{[load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')}</p>
                <p className="text-text-mut text-xs mt-2">{fmt(load.pickup_date, locale)}{load.pickup_time ? ` · ${load.pickup_time}` : ''}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-teal font-semibold mb-2">{t('delivery')}</p>
                <p className="text-text-pri text-sm font-medium">{load.delivery_address ?? '—'}</p>
                <p className="text-text-sec text-sm">{[load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')}</p>
                <p className="text-text-mut text-xs mt-2">{fmt(load.delivery_date, locale)}{load.delivery_time ? ` · ${load.delivery_time}` : ''}</p>
              </div>
            </div>
            </CardBody>
          </Card>

          {/* Load info */}
          <Card>
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('loadDetails')}</h2></CardHeader>
            <CardBody>
            <InfoRow label={t('customer')}  value={customerName ?? load.customer_name_raw} />
            <InfoRow label={t('commodity')} value={load.commodity} />
            <InfoRow label={t('weight')}    value={load.weight_lbs ? `${Number(load.weight_lbs).toLocaleString()} lbs` : null} />
            <InfoRow label={t('miles')}     value={load.total_miles ? `${load.total_miles} mi` : null} />
            <InfoRow label={t('intake')}    value={load.intake_method} />
            </CardBody>
          </Card>

          <LoadOrdersSection
            loadId={load.id} orders={loadOrders} customers={orderCustomers} canAdd={canDispatch}
            canBill={canBill} loadRate={canBill ? load.rate : null}
            currency={resolveCurrency(carrierOrg?.currency)} locale={locale}
          />

          {/* Documents */}
          <div id="documents">
          <LoadDocuments
            documents={documents}
            loadId={load.id}
            orgId={profile.org_id}
            userId={user.id}
            canUpload={canUploadDoc}
            canDelete={canDeleteDoc}
          />
          {canUploadDoc && (
            <div className="mt-3 flex justify-end">
              <SendDocumentsButton
                loadId={load.id}
                documents={documents.map((d) => ({ id: d.id, type: d.type, fileName: d.fileName }))}
                customerEmail={customerEmail}
              />
            </div>
          )}
          </div>

          {(roleHasCapability(profile.role, 'location_share') || roleHasCapability(profile.role, 'problem_report')) && (
            <DriverLoadActions
              loadId={load.id}
              active={['dispatched', 'picked_up', 'in_transit'].includes(load.status ?? '')}
            />
          )}

          {roleHasCapability(profile.role, 'dvir_file') && <DvirForm loadId={load.id} />}
          {roleHasCapability(profile.role, 'fuel_log') && <LoadFuelStops loadId={load.id} />}

          {/* Driver chat */}
          {chatEntitled && (
            <DriverMessageThread loadId={load.id} currentUserId={user.id} locale={locale} />
          )}

          {/* IFTA mileage log */}
          {iftaEntitled && (
            <IftaCrossingsSection
              loadId={load.id}
              orgId={profile.org_id}
              crossings={iftaCrossings}
              canManage={canIfta}
              locale={locale}
            />
          )}

          {/* Timeline */}
          <Card>
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('activity')}</h2></CardHeader>
            <CardBody>
            {!events || events.length === 0 ? (
              <p className="text-text-sec text-sm">{t('noActivityYet')}</p>
            ) : (
              <div className="space-y-3">
                {events.map((e) => {
                  const actor = e.profiles
                    ? [e.profiles.first_name, e.profiles.last_name].filter(Boolean).join(' ')
                    : 'System'
                  return (
                    <div key={e.id} className="flex gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-orange mt-2 shrink-0" />
                      <div>
                        <p className="text-text-pri text-sm">{e.event_type.replace(/_/g, ' ')}</p>
                        {e.note && <p className="text-text-sec text-xs mt-0.5">{e.note}</p>}
                        <p className="text-text-mut text-xs mt-0.5">
                          {actor} · {new Date(e.created_at ?? now).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            </CardBody>
          </Card>
        </div>

        {/* Right: Dispatch panel */}
        <div className="space-y-6">
          <Card id="assignment" className="scroll-mt-6">
            <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('assignment')}</h2></CardHeader>
            <CardBody>
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-text-sec text-[20px]">person</span>
                <div>
                  <p className="text-[10px] text-text-sec uppercase tracking-wider">{t('driver')}</p>
                  <p className="text-text-pri text-sm">{driverName ?? t('unassigned')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-text-sec text-[20px]">local_shipping</span>
                <div>
                  <p className="text-[10px] text-text-sec uppercase tracking-wider">{t('truck')}</p>
                  <p className="text-text-pri text-sm">{vehicleLabel ?? t('unassigned')}</p>
                </div>
              </div>
            </div>

            {canDispatch && (
              <DispatchPanel
                loadId={load.id}
                loadNumber={load.load_number}
                currentStatus={load.status ?? 'draft'}
                currentDriverId={load.driver_id}
                currentVehicleId={load.vehicle_id}
                orgId={profile.org_id}
              />
            )}
            </CardBody>
          </Card>

          {canBill && (
            <CreateInvoiceButton
              loadId={load.id}
              billable={billable}
              existingInvoices={existingInvoices}
              expectedCustomerIds={orderCustomerIds.length ? orderCustomerIds : [load.customer_org_id]}
              amountLabel={formatMoney(load.rate, resolveCurrency(carrierOrg?.currency), locale)}
              customerName={customerName ?? load.customer_name_raw}
            />
          )}

          {loadboardEntitled && (
            <PostToDatButton loadId={load.id} existingPosting={existingDatPosting} />
          )}
        </div>

      </div>
    </div>
  )
}
