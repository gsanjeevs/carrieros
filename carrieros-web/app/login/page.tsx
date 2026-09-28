// app/login/page.tsx
import { getTranslations, getLocale } from 'next-intl/server'
import { signInWithEmail } from './actions'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import PasskeySignInButton from '@/components/passkey/PasskeySignInButton'
import { Button, Callout, Field, Input } from '@/components/ui'

interface Props {
  searchParams: Promise<{ error?: string; next?: string }>
}

// Auth-flow errors (from the redirect() call in actions.ts / auth callback),
// distinct from the API error_code convention used elsewhere (lib/api-auth.ts)
// — these map 1:1 onto login.* keys instead since they're login-specific.
const ERROR_KEYS: Record<string, string> = {
  invalid_credentials: 'invalidCredentials',
  missing_fields:      'invalidCredentials',
  auth_failed:          'invalidCredentials',
  missing_code:         'invalidCredentials',
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams
  const t = await getTranslations('login')
  const locale = await getLocale()

  return (
    <div className="auth-shell min-h-screen bg-surface-page text-text-pri flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="flex justify-end mb-4">
          <LanguageSwitcher current={locale} />
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-brand-orange flex items-center justify-center">
              <span className="text-brand-on-primary font-bold text-sm">C</span>
            </div>
            <span className="text-text-pri font-semibold text-xl tracking-tight">CarrierOS</span>
          </div>
          <p className="text-text-sec text-sm">{t('title')}</p>
        </div>

        {/* Error */}
        {error && (
          <Callout tone="danger" className="mb-4 text-sm">
            {t(ERROR_KEYS[error] ?? 'invalidCredentials')}
          </Callout>
        )}

        {/* Form */}
        <form action={signInWithEmail} className="space-y-4">
          <Field label={t('email')} htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              size="lg"
            />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="text-2xs font-bold uppercase tracking-[1px] text-text-sec">
                {t('password')} <span className="text-brand-orange"> *</span>
              </label>
              {/* Forgot password — hook up later */}
              <span className="text-xs text-brand-orange cursor-pointer hover:underline">
                {t('forgotPassword')}
              </span>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              size="lg"
            />
          </div>

          <Button
            variant="primary"
            size="lg"
            type="submit"
            className="w-full py-2.5"
          >
            {t('signIn')}
          </Button>
        </form>

        {/* Additive — never replaces the password form above (decisions.md
            T15). Renders nothing on browsers/contexts without WebAuthn
            support. */}
        <PasskeySignInButton />

        <p className="mt-6 text-center text-xs text-text-mut">
          {t('noAccount')} <a href="/signup" className="text-brand-orange hover:underline">{t('signUpFree')}</a>
        </p>
        <p className="mt-2 text-center text-xs text-text-mut">
          <a href="mailto:info@shipmentx.com" className="text-brand-orange hover:underline">
            {t('needAccess')}
          </a>
        </p>

      </div>
    </div>
  )
}
