'use client'
// components/PermissionPreview.tsx
// Access-area checklist shown under the role picker in
// app/(app)/team/InviteMemberButton.tsx and app/(app)/drivers/InviteDriverButton.tsx
// — the audit's "permission preview" gap: previously the only signal about
// what a role could do was one plain-language sentence (team.roleHelp_*),
// with no way to see it broken down by area before sending the invite.
import { useTranslations } from 'next-intl'
import { PERMISSION_AREAS, roleHasPermission, type InvitableRole } from '@/lib/domain/role-permissions'

export default function PermissionPreview({ role }: { role: InvitableRole }) {
  const t = useTranslations('team')

  return (
    <div className="rounded-lg border border-divider-ui bg-bg-elevated/40 px-4 py-3">
      <p className="text-xs font-medium text-text-sec mb-2">{t('permissionPreviewTitle')}</p>
      <ul className="space-y-1.5">
        {PERMISSION_AREAS.map((area) => {
          const granted = roleHasPermission(role, area)
          return (
            <li key={area} className="flex items-center gap-2 text-xs">
              <span className={`material-symbols-outlined text-[16px] ${granted ? 'text-success' : 'text-text-mut'}`}>
                {granted ? 'check_circle' : 'remove_circle'}
              </span>
              <span className={granted ? 'text-text-pri' : 'text-text-mut'}>
                {t(`permissionArea_${area}` as never)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
