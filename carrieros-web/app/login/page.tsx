// app/login/page.tsx
import { signInWithEmail } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; next?: string }>
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  missing_fields:      'Please enter your email and password.',
  auth_failed:         'Authentication failed. Try again.',
  missing_code:        'Invalid login link.',
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#f97316] flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="text-white font-semibold text-xl tracking-tight">CarrierOS</span>
          </div>
          <p className="text-slate-400 text-sm">Sign in to your account</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
            {ERROR_MESSAGES[error] ?? 'Something went wrong. Try again.'}
          </div>
        )}

        {/* Form */}
        <form action={signInWithEmail} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3.5 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:border-transparent transition"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
              {/* Forgot password — hook up later */}
              <span className="text-xs text-[#f97316] cursor-pointer hover:underline">
                Forgot password?
              </span>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3.5 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-[#f97316] hover:bg-[#ea6c0a] text-white font-semibold py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:ring-offset-2 focus:ring-offset-[#0f1923]"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need access?{' '}
          <a href="mailto:info@shipmentx.com" className="text-[#f97316] hover:underline">
            Contact your administrator
          </a>
        </p>

      </div>
    </div>
  )
}
