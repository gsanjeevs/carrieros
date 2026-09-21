'use client'
// app/(app)/settings/developer-api/RevokeClientButton.tsx
// Revoke = DELETE /api/v1/oauth-clients/{client_id} (session-authenticated).
// Irreversible from this UI (no "un-revoke" — rotate by creating a new
// client instead), so this uses Modal's confirm-destructive variant, same
// as MemberActions' team-member removal.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/ui'

export default function RevokeClientButton({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter()
  const t = useTranslations('developerApi')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  async function revoke() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/oauth-clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(friendly(json.error_code))
        return
      }
      setConfirming(false)
      router.refresh()
    } catch {
      setError(tCommon('somethingWentWrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(''); setConfirming(true) }}
        className="text-text-sec hover:text-danger transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50 text-xs"
      >
        {t('revoke')}
      </button>

      <Modal
        open={confirming}
        onClose={() => { if (!busy) { setConfirming(false); setError('') } }}
        size="sm"
        title={t('revokeTitle')}
        variant="confirm-destructive"
        onConfirm={revoke}
        confirmLabel={busy ? tCommon('loading') : t('revoke')}
      >
        <p className="text-text-sec text-sm">{t('revokeConfirm', { name })}</p>
        {error && (
          <div className="mt-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
            {error}
          </div>
        )}
      </Modal>
    </>
  )
}
