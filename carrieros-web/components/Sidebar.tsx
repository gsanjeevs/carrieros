// components/Sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/login/actions'

interface NavItem {
  label: string
  href: string
  icon: string
  roles: string[]
}

const NAV: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard',  icon: 'dashboard',        roles: ['owner','solo','dispatcher','finance'] },
  { label: 'Loads',       href: '/loads',       icon: 'local_shipping',   roles: ['owner','solo','dispatcher','finance'] },
  { label: 'Dispatch',    href: '/dispatch',    icon: 'swap_driving_apps',roles: ['owner','solo','dispatcher'] },
  { label: 'Drivers',     href: '/drivers',     icon: 'person',           roles: ['owner','solo','dispatcher'] },
  { label: 'Trucks',      href: '/trucks',      icon: 'fire_truck',       roles: ['owner','solo'] },
  { label: 'Customers',   href: '/customers',   icon: 'business',         roles: ['owner','solo','dispatcher','finance'] },
  { label: 'Invoices',    href: '/finance',     icon: 'receipt_long',     roles: ['owner','solo','finance'] },
  { label: 'Maintenance', href: '/maintenance', icon: 'build',            roles: ['owner','solo','dispatcher'] },
  { label: 'Documents',   href: '/documents',   icon: 'folder',           roles: ['owner','solo','finance'] },
  { label: 'Team',        href: '/team',        icon: 'group',            roles: ['owner','solo'] },
]

interface Props {
  role: string
  userName: string
}

export default function Sidebar({ role, userName }: Props) {
  const pathname = usePathname()
  const visible = NAV.filter((item) => item.roles.includes(role))

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-[#0a1118] border-r border-white/5">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
        <div className="w-7 h-7 rounded-md bg-[#f97316] flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">C</span>
        </div>
        <span className="text-white font-semibold text-base tracking-tight">CarrierOS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#f97316]/10 text-[#f97316]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User + Sign out */}
      <div className="px-3 py-4 border-t border-white/5">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-[#f97316]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[#f97316] text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{userName}</p>
            <p className="text-slate-500 text-xs capitalize">{role}</p>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">logout</span>
            Sign out
          </button>
        </form>
      </div>

    </aside>
  )
}
