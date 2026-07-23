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
import Link from 'next/link'
import AddCustomerButton from './AddCustomerButton'
import BulkImportCustomers from '@/components/BulkImportCustomers'
import ExceptionChip from '@/components/ExceptionChip'
import { getExceptions } from '@/lib/exceptions'
import { getProfileForUser } from '@/lib/queries/profiles'
import { createStorageProvider } from '@/lib/storage'
import { Avatar, Card, EmptyState, Table, TableHeaderCell, TableRow, TableCell } from '@/components/ui'

const VIEW_ROLES   = ['owner', 'solo', 'dispatcher', 'finance']
const MANAGE_ROLES = ['owner', 'solo', 'dispatcher']

type Customer = {
  org_id: number
  customer_number: string | null
  contact_name: string | null
  tags: string[] | null
  notes: string | null
  organizations: { id: number; name: string; email: string | null; phone: string | null; city: string | null; state: string | null; logo_path: string | null } | null
}

// Initials from an organization name for the logo fallback avatar — first
// letter of up to the first two words, e.g. "Sierra Freight Co" -> "SF".
function initialsFor(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const canManage = MANAGE_ROLES.includes(profile.role)
  const params = await searchParams
  const t = await getTranslations('customers')

  const [{ data: customersData, error }, { data: loadsData }, exceptions] = await Promise.all([
    supabase
      .from('customer_details')
      .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(id, name, email, phone, city, state, logo_path)')
      .eq('carrier_org_id', profile.org_id)
      .order('org_id'),
    // One cheap query for load counts per customer — a handful of rows at
    // this scale, grouped in JS rather than issuing one count query per
    // customer.
    supabase
      .from('loads')
      .select('customer_org_id')
      .eq('carrier_org_id', profile.org_id)
      .not('customer_org_id', 'is', null),
    getExceptions(supabase, profile.org_id),
  ])

  if (error) console.error('[customers] list query failed:', error.message)
  const customers = (customersData ?? []) as unknown as Customer[]

  const loadCounts = new Map<number, number>()
  for (const l of loadsData ?? []) {
    if (l.customer_org_id == null) continue
    loadCounts.set(l.customer_org_id, (loadCounts.get(l.customer_org_id) ?? 0) + 1)
  }

  // get_exceptions()'s 'customer' entity_type is currently only produced by
  // the carrier's OWN org_documents (see schema.sql's get_exceptions note on
  // 'customer' being a stand-in entity_type for "an organizations-table
  // row") -- there is no branch that emits exceptions keyed by a customer
  // org's id, so this map will be empty in practice today. Wired anyway per
  // spec/for when that branch gets added, and it's a harmless no-op meanwhile.
  const topExceptionByCustomer = new Map<number, Awaited<ReturnType<typeof getExceptions>>[number]>()
  for (const item of exceptions) {
    if (item.entity_type === 'customer' && !topExceptionByCustomer.has(item.entity_id)) {
      topExceptionByCustomer.set(item.entity_id, item)
    }
  }

  // Signed logo URLs (private `documents` bucket, same convention as
  // load/vehicle documents elsewhere) -- initials fallback when a customer
  // has no logo_path or the signed-URL call fails.
  const logoPaths = customers
    .map((c) => c.organizations?.logo_path)
    .filter((p): p is string => !!p)
  const signedLogoUrls = new Map<string, string>()
  if (logoPaths.length > 0) {
    const storage = createStorageProvider(supabase)
    const results = await Promise.allSettled(
      logoPaths.map((path) => storage.getSignedUrl(path, 60 * 60))
    )
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') signedLogoUrls.set(logoPaths[i], res.value)
    })
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('customerCount', { count: customers.length })}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-3">
            <BulkImportCustomers existingCustomers={customers.map((c) => ({ name: c.organizations?.name ?? null }))} />
            <AddCustomerButton />
          </div>
        )}
      </div>

      {params.created && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
          <p className="text-success text-sm">{t('addedSuccess', { name: params.created })}</p>
        </div>
      )}

      {customers.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center pb-8">
            <EmptyState icon="business" title={t('noCustomersYet')} />
            {canManage && <AddCustomerButton variant="empty" />}
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('customerNumber')}</TableHeaderCell>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell>{t('contact')}</TableHeaderCell>
                <TableHeaderCell>{t('phoneEmail')}</TableHeaderCell>
                <TableHeaderCell>{t('tags')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('loads')}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const org = c.organizations
                const phoneEmail = [org?.phone, org?.email].filter(Boolean).join(' · ')
                const cityState = [org?.city, org?.state].filter(Boolean).join(', ')
                const logoUrl = org?.logo_path ? signedLogoUrls.get(org.logo_path) : undefined
                const topException = topExceptionByCustomer.get(c.org_id)
                const nameCell = (
                  <div className="flex items-center gap-3">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed, expiring Supabase Storage URL, not a static asset next/image can cache
                      <img src={logoUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 bg-white/10" />
                    ) : (
                      <Avatar initials={initialsFor(org?.name)} />
                    )}
                    <div className="min-w-0">
                      <div className="text-text-pri font-medium truncate">{org?.name ?? '—'}</div>
                      {cityState && <div className="text-text-mut text-xs mt-0.5">{cityState}</div>}
                    </div>
                  </div>
                )
                return (
                  <TableRow key={c.org_id}>
                    <TableCell className="font-medium text-text-pri">
                      {c.customer_number ? (
                        <Link
                          href={`/customers/${c.customer_number}`}
                          className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                        >
                          {c.customer_number}
                        </Link>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{nameCell}</TableCell>
                    <TableCell>{c.contact_name ?? '—'}</TableCell>
                    <TableCell>{phoneEmail || '—'}</TableCell>
                    <TableCell>
                      {c.tags && c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {c.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#f97316]/15 text-[#f97316]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-text-mut">—</span>
                      )}
                    </TableCell>
                    <TableCell numeric>{loadCounts.get(c.org_id) ?? 0}</TableCell>
                    <TableCell>{topException && <ExceptionChip item={topException} />}</TableCell>
                  </TableRow>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
