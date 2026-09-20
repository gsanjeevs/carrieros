'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from '@/app/login/actions'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { roleHasCapability, type RoleCapability } from '@/lib/generated/role-capabilities'

// Visibility is expressed as a `capability` wherever the generated
// role_capabilities table (migrations 0009 + 0023) already has a row set that
// means exactly this nav item — same pattern proxy.ts's ROLE_ROUTES uses for
// the matching route guard, so the sidebar and the middleware cannot drift.
// A few items have no capability whose role set matches them today; those
// keep an explicit `roles` list with a note saying why.
interface NavItem {
  labelKey: string
  href: string
  icon: string
  capability?: RoleCapability
  roles?: string[]
}

function canSee(item: NavItem, role: string): boolean {
  return item.capability ? roleHasCapability(role, item.capability) : (item.roles ?? []).includes(role)
}

interface NavSection {
  sectionKey: string
  items: NavItem[]
}

// Grouped per design-tokens.md's "Sidebar (Desktop only)" section-label
// pattern (MAIN/FLEET/BILLING/TEAM); section labels come from the `nav`
// message catalog under `nav.section_*`.
const NAV_SECTIONS: NavSection[] = [
  {
    sectionKey: 'main',
    items: [
      { labelKey: 'dashboard', href: '/dashboard', icon: 'dashboard',         capability: 'dashboard' },
      // No capability's role set is {owner,solo,dispatcher} *and* means
      // "exception queue" — `dispatch`/`loads_manage` share the set but not
      // the meaning, so this stays explicit until a capability exists for it.
      { labelKey: 'exceptions', href: '/exceptions', icon: 'warning',         roles: ['owner','solo','dispatcher'] },
      // {owner,solo,dispatcher,finance} (finance reads loads it bills
      // against) matches no capability's role set today.
      { labelKey: 'loads',     href: '/loads',      icon: 'local_shipping',    roles: ['owner','solo','dispatcher','finance'] },
      { labelKey: 'dispatch',  href: '/dispatch',   icon: 'swap_driving_apps',capability: 'dispatch' },
      // Wider than `customers_manage` — finance sees the directory read-only.
      { labelKey: 'customers', href: '/customers',  icon: 'business',         roles: ['owner','solo','dispatcher','finance'] },
      // Company compliance docs, not load paperwork: narrower than
      // `documents_read` (which includes dispatcher/driver).
      { labelKey: 'documents', href: '/documents',  icon: 'folder',           roles: ['owner','solo','finance'] },
    ],
  },
  {
    sectionKey: 'fleet',
    items: [
      { labelKey: 'drivers',     href: '/drivers',     icon: 'person',     capability: 'drivers' },
      { labelKey: 'vehicles',    href: '/vehicles',    icon: 'fire_truck', capability: 'vehicles_manage' },
      // Viewing maintenance is wider than `service_log` (which is the
      // owner/solo write capability) and matches no capability's role set.
      { labelKey: 'maintenance', href: '/maintenance', icon: 'build',      roles: ['owner','solo','dispatcher'] },
    ],
  },
  {
    sectionKey: 'billing',
    items: [
      { labelKey: 'finance', href: '/finance', icon: 'payments', capability: 'finance' },
      { labelKey: 'invoices', href: '/invoices', icon: 'receipt_long', capability: 'invoice_actions' },
      // Drivers see their own settlements too, so this is wider than
      // `settlements_manage`.
      { labelKey: 'settlements', href: '/settlements', icon: 'payments', roles: ['owner','solo','finance','driver'] },
      { labelKey: 'billing',  href: '/billing',  icon: 'credit_card',  capability: 'subscription_management' },
    ],
  },
  {
    sectionKey: 'team',
    items: [
      { labelKey: 'team',     href: '/team',     icon: 'group',    capability: 'team' },
      // Everyone with a tenant role has settings; no capability covers that.
      { labelKey: 'settings', href: '/settings', icon: 'settings', roles: ['owner','solo','driver','dispatcher','finance'] },
    ],
  },
]

// role_token color -> badge classes. Literal strings (not template-built)
// so Tailwind's v4 content scanner picks them up at build time.
const ROLE_BADGE_CLASSES: Record<string, string> = {
  'brand-orange': 'bg-brand-orange/10 text-brand-orange',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
  purple: 'bg-purple/10 text-purple',
  'navy-muted': 'bg-navy-muted/10 text-navy-muted',
}

interface Props {
  role: string
  userName: string
  userId: string
  preferredLanguage: string
  roleAbbreviation?: string
  roleColorToken?: string
}

export default function Sidebar({ role, userName, userId, preferredLanguage, roleAbbreviation, roleColorToken }: Props) {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const tCommon = useTranslations('common')
  const tRoles = useTranslations('roles')
  // Defensive: `role` is a raw DB string: fall back to it verbatim rather
  // than throwing if a role somehow has no translation entry yet.
  function roleLabel(code: string) {
    try {
      return tRoles(code as never)
    } catch {
      return code
    }
  }
  const sections = NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((item) => canSee(item, role)) }))
    .filter((section) => section.items.length > 0)

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-navy border-r border-divider-ui">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-divider-ui">
        <div className="w-7 h-7 rounded-md bg-brand-orange flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">C</span>
        </div>
        <span className="text-white font-extrabold text-xl tracking-tight">CarrierOS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-3 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.sectionKey}>
            <p className="px-3 mb-1 text-2xs font-bold uppercase tracking-widest text-navy-muted">
              {t(`section_${section.sectionKey}`)}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                      active
                        ? 'bg-brand-orange/10 text-brand-orange'
                        : 'text-slate-400 hover:text-white hover:bg-surface-subtle'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] leading-none">{item.icon}</span>
                    {t(item.labelKey)}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User + Language + Sign out */}
      <div className="px-3 py-4 border-t border-divider-ui">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
            <span className="text-avatar-text text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{userName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleAbbreviation && (
                <span
                  className={`inline-flex items-center justify-center rounded px-1 py-px text-[10px] font-bold leading-tight ${
                    ROLE_BADGE_CLASSES[roleColorToken ?? ''] ?? 'bg-navy-muted/10 text-navy-muted'
                  }`}
                >
                  {roleAbbreviation}
                </span>
              )}
              <p className="text-slate-500 text-xs truncate">{roleLabel(role)}</p>
            </div>
          </div>
        </div>
        <div className="px-3 py-2 mb-1">
          <LanguageSwitcher userId={userId} current={preferredLanguage} compact />
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">logout</span>
            {tCommon('signOut')}
          </button>
        </form>
      </div>

    </aside>
  )
}
