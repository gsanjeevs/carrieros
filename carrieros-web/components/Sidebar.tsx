'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from '@/app/login/actions'
import LanguageSwitcher from '@/components/LanguageSwitcher'

interface NavItem {
  labelKey: string
  href: string
  icon: string
  roles: string[]
}

const NAV: NavItem[] = [
  { labelKey: 'dashboard',   href: '/dashboard',  icon: 'dashboard',        roles: ['owner','solo','dispatcher','finance'] },
  { labelKey: 'loads',       href: '/loads',       icon: 'local_shipping',   roles: ['owner','solo','dispatcher','finance'] },
  { labelKey: 'dispatch',    href: '/dispatch',    icon: 'swap_driving_apps',roles: ['owner','solo','dispatcher'] },
  { labelKey: 'drivers',     href: '/drivers',     icon: 'person',           roles: ['owner','solo','dispatcher'] },
  { labelKey: 'trucks',      href: '/trucks',      icon: 'fire_truck',       roles: ['owner','solo'] },
  { labelKey: 'customers',   href: '/customers',   icon: 'business',         roles: ['owner','solo','dispatcher','finance'] },
  { labelKey: 'invoices',    href: '/invoices',    icon: 'receipt_long',     roles: ['owner','solo','finance'] },
  { labelKey: 'maintenance', href: '/maintenance', icon: 'build',            roles: ['owner','solo','dispatcher'] },
  { labelKey: 'documents',   href: '/documents',   icon: 'folder',           roles: ['owner','solo','finance'] },
  { labelKey: 'team',        href: '/team',        icon: 'group',            roles: ['owner','solo'] },
  { labelKey: 'billing',     href: '/billing',     icon: 'credit_card',      roles: ['owner','solo'] },
  { labelKey: 'settings',    href: '/settings',    icon: 'settings',         roles: ['owner','solo','driver','dispatcher','finance'] },
]

interface Props {
  role: string
  userName: string
  userId: string
  preferredLanguage: string
}

export default function Sidebar({ role, userName, userId, preferredLanguage }: Props) {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const tCommon = useTranslations('common')
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
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>

      {/* User + Language + Sign out */}
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
        <div className="px-3 py-2 mb-1">
          <LanguageSwitcher userId={userId} current={preferredLanguage} />
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">logout</span>
            {tCommon('signOut')}
          </button>
        </form>
      </div>

    </aside>
  )
}
