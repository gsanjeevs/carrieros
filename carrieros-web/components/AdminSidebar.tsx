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
import { signOut } from '@/app/login/actions'

interface NavItem {
  label: string
  href: string
  icon: string
  roles: string[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Triage Queue',        href: '/admin',         icon: 'inbox',         roles: ['sx_owner', 'sx_finance', 'sx_support'] },
  { label: 'Customer Health',     href: '/admin/health',   icon: 'monitor_heart', roles: ['sx_owner', 'sx_finance', 'sx_support'] },
  { label: 'Billing & Payments',  href: '/admin/billing',  icon: 'payments',      roles: ['sx_owner', 'sx_finance'] },
  { label: 'Sales Pipeline',      href: '/admin/pipeline', icon: 'trending_up',   roles: ['sx_owner', 'sx_finance'] },
  { label: 'Audit & Activity',    href: '/admin/audit',    icon: 'history',       roles: ['sx_owner', 'sx_finance', 'sx_support'] },
  { label: 'Feature Flags',       href: '/admin/flags',    icon: 'flag',          roles: ['sx_owner'] },
]

const ROLE_LABEL: Record<string, string> = {
  sx_owner: 'SX Owner',
  sx_finance: 'SX Finance',
  sx_support: 'SX Support',
}

export default function AdminSidebar({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role))

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-navy border-r border-white/5">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
        <div className="w-7 h-7 rounded-md bg-brand-orange flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">S</span>
        </div>
        <span className="text-white font-extrabold text-xl tracking-tight">ShipmentX</span>
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
                  ? 'bg-brand-orange/10 text-brand-orange'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/5">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
            <span className="text-avatar-text text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{userName}</p>
            <p className="text-slate-500 text-xs truncate">{ROLE_LABEL[role] ?? role}</p>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">logout</span>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
