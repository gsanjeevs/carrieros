'use client'
// components/AdminSidebar.tsx
// Nav for the ShipmentX platform-staff surface (audit gap #14) — a
// distinct sidebar from components/Sidebar.tsx's tenant nav, since none of
// Loads/Dispatch/Customers/etc. apply to an sx_* profile. Matches
// mockup-23's screen set: Triage Queue, Customer Health Board, Billing &
// Payments, Sales Pipeline, Audit & Activity, Feature Flags (Org Detail is
// a drill-down from Health, not its own nav item).
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from '@/app/login/actions'
import { roleHasCapability, type RoleCapability } from '@/lib/generated/role-capabilities'

// Visibility comes from the generated role_capabilities table (migrations
// 0009 + 0023), the same source proxy.ts's `/admin` guard reads — not a
// hand-written sx_* list that can drift from it.
interface NavItem {
  labelKey: string
  href: string
  icon: string
  capability: RoleCapability
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: 'triage',  href: '/admin',         icon: 'inbox',         capability: 'admin' },
  { labelKey: 'support', href: '/admin/support', icon: 'support_agent', capability: 'admin_support' },
  { labelKey: 'health',  href: '/admin/health',   icon: 'monitor_heart', capability: 'admin' },
  { labelKey: 'billing', href: '/admin/billing',  icon: 'payments',      capability: 'admin_billing' },
  { labelKey: 'pipeline', href: '/admin/pipeline', icon: 'trending_up',  capability: 'admin_billing' },
  { labelKey: 'audit',   href: '/admin/audit',    icon: 'history',       capability: 'admin' },
  // Debug/Error Log viewer (app_error_log, migration 0038) -- best-effort
  // mirror of lib/observability.ts logError() calls. Gated on the same bare
  // 'admin' capability as triage/health/audit: it's a read-only diagnostic
  // view, not a commercial or destructive action.
  { labelKey: 'errorLog', href: '/admin/logs',    icon: 'bug_report',    capability: 'admin' },
  { labelKey: 'flags',   href: '/admin/flags',    icon: 'flag',          capability: 'admin_flags' },
  { labelKey: 'roles',   href: '/admin/roles',    icon: 'admin_panel_settings', capability: 'admin_flags' },
  // LLM provider abstraction (decisions.md T17) — which of Anthropic/OpenAI/OpenAI-compatible
  // every LLM call in the app uses. sx_owner only (admin_ai_config, migration 0031), same narrow-
  // capability shape as admin_flags/admin_billing above, not the bare 'admin' every sx_* role holds.
  { labelKey: 'aiConfig', href: '/admin/ai-config', icon: 'smart_toy',    capability: 'admin_ai_config' },
  // Passkey/WebAuthn management (decisions.md T15) — the tenant Sidebar links
  // to the same /settings/security page the same way (labelKey 'security',
  // icon 'passkey'). Gated on 'admin' rather than settings_view (sx_* roles
  // don't hold that tenant capability) since all three sx_* roles hold
  // 'admin', same as triage/health/audit above — every platform-staff user
  // manages their own credentials, not just some.
  { labelKey: 'security', href: '/settings/security', icon: 'passkey',   capability: 'admin' },
]

export default function AdminSidebar({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname()
  const t = useTranslations('admin.nav')
  const tRole = useTranslations('admin.roleLabels')
  const tCommon = useTranslations('common')
  const items = NAV_ITEMS.filter((item) => roleHasCapability(role, item.capability))

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const roleLabel = ['sx_owner', 'sx_finance', 'sx_support'].includes(role) ? tRole(role as 'sx_owner' | 'sx_finance' | 'sx_support') : role

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-navigation-surface border-r border-navigation-border">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-navigation-border">
        <div className="w-7 h-7 rounded-md bg-brand-orange flex items-center justify-center flex-shrink-0">
          <span className="text-brand-on-primary font-bold text-xs">S</span>
        </div>
        <span className="text-navigation-primary font-extrabold text-xl tracking-tight">ShipmentX</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                active
                  ? 'bg-brand-orange/10 text-navigation-primary'
                  : 'text-navigation-secondary hover:text-navigation-primary hover:bg-navigation-hover'
              }`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none">{item.icon}</span>
              {t(item.labelKey as 'triage' | 'support' | 'health' | 'billing' | 'pipeline' | 'audit' | 'errorLog' | 'flags' | 'roles' | 'aiConfig' | 'security')}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-navigation-border">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
            <span className="text-avatar-text text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-navigation-primary text-xs font-medium truncate">{userName}</p>
            <p className="text-navigation-secondary text-xs truncate">{roleLabel}</p>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-navigation-secondary hover:text-navigation-primary hover:bg-navigation-hover transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">logout</span>
            {tCommon('signOut')}
          </button>
        </form>
      </div>
    </aside>
  )
}
