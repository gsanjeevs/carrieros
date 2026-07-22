// app/(app)/loads/[load_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchPanel from '@/components/DispatchPanel'
import LoadDocuments, { type DocType, type LoadDocument } from '@/components/LoadDocuments'
import { formatDateTime, toDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import CreateInvoiceButton from './CreateInvoiceButton'

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

const STATUS_COLOR: Record<string, string> = {
  draft:      'bg-slate-500/20 text-slate-400',
  scheduled:  'bg-blue-500/20 text-blue-400',
  dispatched: 'bg-[#f97316]/20 text-[#f97316]',
  picked_up:  'bg-amber-500/20 text-amber-400',
  in_transit: 'bg-[#1abc9c]/20 text-[#1abc9c]',
  delivered:  'bg-green-500/20 text-green-400',
  invoiced:   'bg-purple-500/20 text-purple-400',
  paid:       'bg-green-500/20 text-green-400',
}

function fmt(date: string | null, locale: string) {
  if (!date) return '—'
  return toDate(date).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="text-white text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ load_number: string }>
}) {
  const { load_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('loads')
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

  // Fetch customer name if linked
  let customerName: string | null = null
  if (load.customer_org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', load.customer_org_id)
      .single()
    customerName = org?.name ?? null
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

  // Billing — owner/solo/finance only (same roles as the `billing_invoices_all`
  // RLS policy; for anyone else this query returns nothing anyway).
  const canBill = ['owner', 'solo', 'finance'].includes(profile.role)
  let existingInvoiceNumber: string | null = null
  if (canBill) {
    const { data: existingInvoice } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('load_id', load.id)
      .maybeSingle()
    existingInvoiceNumber = existingInvoice?.invoice_number ?? null
  }
  const billable = canBill && ['delivered', 'invoiced'].includes(load.status ?? '')

  const { data: carrierOrg } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', profile.org_id)
    .maybeSingle()

  const showRate    = ['owner', 'solo', 'finance'].includes(profile.role)
  const canDispatch = ['owner', 'solo', 'dispatcher'].includes(profile.role)
  const canUploadDoc = ['owner', 'solo', 'dispatcher'].includes(profile.role)
  const canDeleteDoc = ['owner', 'solo'].includes(profile.role)

  const currentIdx  = STATUS_FLOW.findIndex(s => s.key === load.status)
  const driverName  = load.drivers?.profiles
    ? [load.drivers.profiles.first_name, load.drivers.profiles.last_name].filter(Boolean).join(' ')
    : null
  const vehicleLabel  = load.vehicles
    ? `${load.vehicles.vehicle_number ?? ''} ${load.vehicles.nickname}`.trim()
    : null

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/loads" className="text-slate-500 hover:text-white transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>
            <h1 className="text-2xl font-semibold text-white">{load.load_number}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[load.status ?? 'draft'] ?? STATUS_COLOR.draft}`}>
              {STATUS_FLOW.find(s => s.key === load.status)?.label ?? load.status}
            </span>
          </div>
          <p className="text-slate-400 text-sm ml-9">
            {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ')}
            {' → '}
            {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ')}
          </p>
        </div>
      </div>

      {/* Status timeline */}
      <div className="bg-white/5 border border-white/8 rounded-xl p-5 mb-6 shadow-card-dark">
        <div className="flex items-center gap-0 overflow-x-auto">
          {STATUS_FLOW.map((s, i) => {
            const done    = i < currentIdx
            const current = i === currentIdx
            return (
              <div key={s.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                    current ? 'bg-[#f97316] ring-2 ring-[#f97316]/30' :
                    done    ? 'bg-[#f97316]/20' : 'bg-white/5'
                  }`}>
                    <span className={`material-symbols-outlined text-[16px] ${
                      current ? 'text-white' : done ? 'text-[#f97316]' : 'text-slate-600'
                    }`}>{s.icon}</span>
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${
                    current ? 'text-[#f97316]' : done ? 'text-slate-400' : 'text-slate-600'
                  }`}>{s.label}</span>
                </div>
                {i < STATUS_FLOW.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${done ? 'bg-[#f97316]/40' : 'bg-white/8'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Load details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Route */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <h2 className="text-white font-medium text-sm mb-4">{t('route')}</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#f97316] font-semibold mb-2">{t('pickup')}</p>
                <p className="text-white text-sm font-medium">{load.pickup_address ?? '—'}</p>
                <p className="text-slate-400 text-sm">{[load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')}</p>
                <p className="text-slate-500 text-xs mt-2">{fmt(load.pickup_date, locale)}{load.pickup_time ? ` · ${load.pickup_time}` : ''}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#1abc9c] font-semibold mb-2">{t('delivery')}</p>
                <p className="text-white text-sm font-medium">{load.delivery_address ?? '—'}</p>
                <p className="text-slate-400 text-sm">{[load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')}</p>
                <p className="text-slate-500 text-xs mt-2">{fmt(load.delivery_date, locale)}{load.delivery_time ? ` · ${load.delivery_time}` : ''}</p>
              </div>
            </div>
          </div>

          {/* Load info */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <h2 className="text-white font-medium text-sm mb-3">{t('loadDetails')}</h2>
            <InfoRow label={t('customer')}  value={customerName ?? load.customer_name_raw} />
            <InfoRow label={t('commodity')} value={load.commodity} />
            <InfoRow label={t('weight')}    value={load.weight_lbs ? `${Number(load.weight_lbs).toLocaleString()} lbs` : null} />
            <InfoRow label={t('miles')}     value={load.total_miles ? `${load.total_miles} mi` : null} />
            {showRate && <InfoRow label={t('rate')} value={load.rate != null ? formatMoney(load.rate, carrierOrg?.currency ?? 'USD', locale) : null} />}
            <InfoRow label={t('intake')}    value={load.intake_method} />
          </div>

          {/* Documents */}
          <LoadDocuments
            documents={documents}
            loadId={load.id}
            orgId={profile.org_id}
            userId={user.id}
            canUpload={canUploadDoc}
            canDelete={canDeleteDoc}
          />

          {/* Timeline */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <h2 className="text-white font-medium text-sm mb-4">{t('activity')}</h2>
            {!events || events.length === 0 ? (
              <p className="text-slate-500 text-sm">{t('noActivityYet')}</p>
            ) : (
              <div className="space-y-3">
                {events.map((e) => {
                  const actor = e.profiles
                    ? [e.profiles.first_name, e.profiles.last_name].filter(Boolean).join(' ')
                    : 'System'
                  return (
                    <div key={e.id} className="flex gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#f97316] mt-2 shrink-0" />
                      <div>
                        <p className="text-white text-sm">{e.event_type.replace(/_/g, ' ')}</p>
                        {e.note && <p className="text-slate-400 text-xs mt-0.5">{e.note}</p>}
                        <p className="text-slate-600 text-xs mt-0.5">
                          {actor} · {new Date(e.created_at ?? Date.now()).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dispatch panel */}
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <h2 className="text-white font-medium text-sm mb-4">{t('assignment')}</h2>
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-slate-500 text-[20px]">person</span>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{t('driver')}</p>
                  <p className="text-white text-sm">{driverName ?? t('unassigned')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-slate-500 text-[20px]">local_shipping</span>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{t('truck')}</p>
                  <p className="text-white text-sm">{vehicleLabel ?? t('unassigned')}</p>
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
          </div>

          {canBill && (
            <CreateInvoiceButton
              loadId={load.id}
              billable={billable}
              existingInvoiceNumber={existingInvoiceNumber}
              amountLabel={formatMoney(load.rate, carrierOrg?.currency ?? 'USD', locale)}
              customerName={customerName ?? load.customer_name_raw}
            />
          )}
        </div>

      </div>
    </div>
  )
}
