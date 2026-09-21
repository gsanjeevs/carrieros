'use client'
// app/(app)/settings/security/PasskeySettings.tsx
// Register/list/rename/delete passkeys for the current user (decisions.md
// T15). Direct browser-client Supabase calls, no API route — same pattern
// ProfileSettingsForm.tsx established (Supabase Auth's own /passkeys/*
// endpoints do all the verification server-side; there is nothing left for
// this app's own backend to check beyond what @supabase/supabase-js already
// sends with the caller's session token).
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { isPasskeySupported } from '@/lib/webauthn-support'
import { logError } from '@/lib/observability'
import { Button, Callout, EmptyState, Input, Modal } from '@/components/ui'

type Passkey = {
  id: string
  friendly_name?: string
  created_at: string
  last_used_at?: string
}

export default function PasskeySettings() {
  const t = useTranslations('security')
  const [checkedSupport, setCheckedSupport] = useState(false)
  const [supported, setSupported] = useState(false)

  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [registering, setRegistering] = useState(false)
  const [registerError, setRegisterError] = useState('')

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState('')

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    // Deferred a microtask so this isn't a synchronous setState in the
    // effect body (react-hooks/set-state-in-effect) — same fix as the
    // established precedent in app/(admin)/admin/page.tsx.
    void Promise.resolve().then(() => {
      setSupported(isPasskeySupported())
      setCheckedSupport(true)
    })
  }, [])

  async function loadPasskeys() {
    setLoadError(false)
    const supabase = createClient()
    const { data, error } = await supabase.auth.passkey.list()
    if (error) {
      logError({ route: 'settings-security' }, error)
      setLoadError(true)
      return
    }
    setPasskeys(data ?? [])
  }

  useEffect(() => {
    // Not calling loadPasskeys directly here — eslint's
    // react-hooks/set-state-in-effect rule traces a locally-defined
    // function reference back to its own setState calls and flags invoking
    // it directly in an effect body (same issue/fix as
    // components/DriverMessageThread.tsx's `load` precedent).
    if (supported) void Promise.resolve().then(loadPasskeys)
  }, [supported])

  async function registerPasskey() {
    setRegistering(true)
    setRegisterError('')
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.registerPasskey()
      if (error || !data) {
        // Covers both a real failure and a user-cancelled ceremony
        // (WebAuthnError ERROR_CEREMONY_ABORTED) — never log the credential
        // itself, the error object is enough context.
        if (error) logError({ route: 'settings-security' }, error)
        setRegisterError(t('registerError'))
        return
      }
      await loadPasskeys()
    } catch (err) {
      logError({ route: 'settings-security' }, err)
      setRegisterError(t('registerError'))
    } finally {
      setRegistering(false)
    }
  }

  function startRename(pk: Passkey) {
    setRenamingId(pk.id)
    setRenameValue(pk.friendly_name ?? '')
    setRenameError('')
  }

  async function saveRename() {
    if (!renamingId) return
    setRenameBusy(true)
    setRenameError('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.passkey.update({
        passkeyId: renamingId,
        friendlyName: renameValue.trim() || t('unnamedPasskey'),
      })
      if (error) {
        logError({ route: 'settings-security' }, error)
        setRenameError(t('renameError'))
        return
      }
      await loadPasskeys()
      setRenamingId(null)
    } finally {
      setRenameBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deletingId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.passkey.delete({ passkeyId: deletingId })
      if (error) {
        logError({ route: 'settings-security' }, error)
        setDeleteError(t('deleteError'))
        return
      }
      setDeletingId(null)
      await loadPasskeys()
    } finally {
      setDeleteBusy(false)
    }
  }

  // Nothing rendered until feature detection resolves (avoids a hydration
  // mismatch flashing the unsupported message on a supported browser).
  if (!checkedSupport) return null

  if (!supported) {
    return (
      <Callout tone="info" icon={<span className="material-symbols-outlined text-[16px]">info</span>}>
        {t('unsupportedBrowser')}
      </Callout>
    )
  }

  const deletingPasskey = passkeys?.find((pk) => pk.id === deletingId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-text-sec text-sm">{t('description')}</p>
        <Button size="sm" onClick={registerPasskey} disabled={registering} loading={registering}>
          {registering ? t('registering') : t('addPasskey')}
        </Button>
      </div>

      {registerError && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
          {registerError}
        </div>
      )}

      {loadError && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
          {t('loadError')}
        </div>
      )}

      {passkeys === null && !loadError && (
        <p className="text-text-mut text-xs">{t('loading')}</p>
      )}

      {passkeys !== null && passkeys.length === 0 && (
        <EmptyState icon="passkey" title={t('emptyTitle')} description={t('emptyDescription')} />
      )}

      {passkeys !== null && passkeys.length > 0 && (
        <ul className="divide-y divide-border-ui">
          {passkeys.map((pk) => (
            <li key={pk.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {renamingId === pk.id ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        className="max-w-[220px]"
                      />
                      <Button size="sm" onClick={saveRename} disabled={renameBusy} loading={renameBusy}>
                        {t('save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => { setRenamingId(null); setRenameError('') }}
                        disabled={renameBusy}
                      >
                        {t('cancel')}
                      </Button>
                    </div>
                    {renameError && <p className="text-danger text-xs mt-1.5">{renameError}</p>}
                  </div>
                ) : (
                  <>
                    <p className="text-text-pri text-sm font-medium truncate">
                      {pk.friendly_name || t('unnamedPasskey')}
                    </p>
                    <p className="text-text-mut text-xs mt-0.5">
                      {t('createdOn', { date: new Date(pk.created_at).toLocaleDateString() })}
                      {pk.last_used_at && ` · ${t('lastUsed', { date: new Date(pk.last_used_at).toLocaleDateString() })}`}
                    </p>
                  </>
                )}
              </div>
              {renamingId !== pk.id && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => startRename(pk)}
                    className="text-text-sec hover:text-text-pri transition text-xs focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded"
                  >
                    {t('rename')}
                  </button>
                  <button
                    onClick={() => { setDeleteError(''); setDeletingId(pk.id) }}
                    className="text-text-sec hover:text-danger transition text-xs focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded"
                  >
                    {t('delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={deletingPasskey !== null}
        onClose={() => { if (!deleteBusy) { setDeletingId(null); setDeleteError('') } }}
        size="sm"
        title={t('deleteTitle')}
        variant="confirm-destructive"
        onConfirm={confirmDelete}
        confirmLabel={deleteBusy ? t('deleting') : t('delete')}
      >
        <p className="text-text-sec text-sm">
          {t('deleteConfirm', { name: deletingPasskey?.friendly_name || t('unnamedPasskey') })}
        </p>
        {deleteError && (
          <div className="mt-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
            {deleteError}
          </div>
        )}
      </Modal>
    </div>
  )
}
