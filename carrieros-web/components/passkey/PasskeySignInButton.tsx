'use client'
// components/passkey/PasskeySignInButton.tsx
// "Sign in with a passkey" — additive alongside app/login/page.tsx's existing
// password form (decisions.md T15). Passkey sign-in has to run in the
// browser (navigator.credentials.get(), invoked internally by
// supabase.auth.signInWithPasskey()) so this can't be a server action like
// signInWithEmail — it's a client component the login page renders next to
// the form, not a replacement for it.
//
// Feature-detected: renders nothing on browsers/contexts without WebAuthn
// support (no secure context, no Credential Management API) rather than
// showing a button that would only fail — see lib/webauthn-support.ts.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { isPasskeySupported } from '@/lib/webauthn-support'
import { logError } from '@/lib/observability'

export default function PasskeySignInButton() {
  const router = useRouter()
  const t = useTranslations('login')
  const [supported, setSupported] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // Feature detection reads `window`, so it can only run after mount —
  // during SSR/first paint this renders nothing either way, avoiding a
  // hydration mismatch. Deferred a microtask so this isn't a synchronous
  // setState in the effect body (react-hooks/set-state-in-effect) — same
  // fix as the established precedent in app/(admin)/admin/page.tsx.
  useEffect(() => {
    void Promise.resolve().then(() => setSupported(isPasskeySupported()))
  }, [])

  if (!supported) return null

  async function handleClick() {
    setLoading(true)
    setError(false)

    try {
      const supabase = createClient()
      const { data, error: signInError } = await supabase.auth.signInWithPasskey()

      if (signInError || !data?.session) {
        // Covers both a real failure and a user-cancelled ceremony
        // (WebAuthnError ERROR_CEREMONY_ABORTED) — either way, no session
        // was created, so just let them retry or fall back to the password
        // form above; never log the ceremony's credential data itself.
        if (signInError) logError({ route: 'login-passkey' }, signInError)
        setError(true)
        setLoading(false)
        return
      }

      // Mirrors signInWithEmail's server-side redirect target
      // (app/login/actions.ts) — proxy.ts's role-based route guard sends
      // non-dashboard roles (e.g. sx_* platform staff) on to their own home
      // from there, same as every other login path.
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      logError({ route: 'login-passkey' }, err)
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-slate-500">{t('or')}</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white font-medium py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-orange focus:ring-offset-2 focus:ring-offset-navy disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">passkey</span>
        {loading ? t('passkeySigningIn') : t('signInWithPasskey')}
      </button>

      {error && (
        <p className="mt-2 text-center text-xs text-red-400">{t('passkeyError')}</p>
      )}
    </div>
  )
}
