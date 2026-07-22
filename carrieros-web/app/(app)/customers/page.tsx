// app/(app)/customers/page.tsx
// Customer directory — owner/solo/dispatcher/finance can view (matches
// Sidebar.tsx's nav role gate and customer_details' carrier_customer_select
// RLS policy, which has no role restriction). Creating a customer is
// narrower — create_customer_org() (and customer_details' own write policy)
// only allow owner/solo/dispatcher, so finance sees the directory read-only
// (no Add Customer button).
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import AddCustomerButton from './AddCustomerButton'

const VIEW_ROLES   = ['owner', 'solo', 'dispatcher', 'finance']
const MANAGE_ROLES = ['owner', 'solo', 'dispatcher']

type Customer = {
  org_id: number
  customer_number: string | null
  contact_name: string | null
  tags: string[] | null
  notes: string | null
  organizations: { id: number; name: string; email: string | null; phone: string | null; city: string | null; state: string | null } | null
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const canManage = MANAGE_ROLES.includes(profile.role)
  const params = await searchParams
  const t = await getTranslations('customers')

  const { data: customersData, error } = await supabase
    .from('customer_details')
    .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(id, name, email, phone, city, state)')
    .eq('carrier_org_id', profile.org_id)
    .order('org_id')

  if (error) console.error('[customers] list query failed:', error.message)
  const customers = (customersData ?? []) as unknown as Customer[]

  // One cheap query for load counts per customer — a handful of rows at this
  // scale, grouped in JS rather than issuing one count query per customer.
  const { data: loadsData } = await supabase
    .from('loads')
    .select('customer_org_id')
    .eq('carrier_org_id', profile.org_id)
    .not('customer_org_id', 'is', null)

  const loadCounts = new Map<number, number>()
  for (const l of loadsData ?? []) {
    if (l.customer_org_id == null) continue
    loadCounts.set(l.customer_org_id, (loadCounts.get(l.customer_org_id) ?? 0) + 1)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('customerCount', { count: customers.length })}</p>
        </div>
        {canManage && <AddCustomerButton />}
      </div>

      {params.created && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3 shadow-card-dark">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('addedSuccess', { name: params.created })}</p>
        </div>
      )}

      {customers.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">business</span>
          <p className="text-slate-500 text-sm mt-3">{t('noCustomersYet')}</p>
          {canManage && <AddCustomerButton variant="empty" />}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('customerNumber')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('name')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('contact')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('phoneEmail')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('tags')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('loads')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {customers.map((c) => {
                const org = c.organizations
                const phoneEmail = [org?.phone, org?.email].filter(Boolean).join(' · ')
                const cityState = [org?.city, org?.state].filter(Boolean).join(', ')
                return (
                  <tr key={c.org_id} className="hover:bg-white/[0.07] transition-colors duration-150">
                    <td className="px-5 py-3.5 text-white font-medium">{c.customer_number ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="text-white font-medium">{org?.name ?? '—'}</div>
                      {cityState && <div className="text-slate-500 text-xs mt-0.5">{cityState}</div>}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{c.contact_name ?? '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">{phoneEmail || '—'}</td>
                    <td className="px-4 py-3.5">
                      {c.tags && c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {c.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#f97316]/15 text-[#f97316]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-300">{loadCounts.get(c.org_id) ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
