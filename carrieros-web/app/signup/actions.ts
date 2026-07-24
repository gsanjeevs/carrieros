// app/signup/actions.ts
// Self-serve signup (mockup-09). R3b category 1 — supabase.auth.signUp() runs
// server-side so a failed signup never leaves a half-created client-side
// session dangling; the created account still has no org_id, so it lands on
// the existing /onboarding flow exactly like an admin-invited user would,
// carrying the chosen tier forward via a query param (api/onboarding/route.ts
// is the only place that actually writes carrier_details.tier).
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const VALID_TIERS = ['starter', 'growth'] as const // self-serve signup only offers these two, per mockup-09

export async function signUpWithEmail(formData: FormData) {
  const name = (formData.get('name') as string || '').trim()
  const email = (formData.get('email') as string || '').trim()
  const password = formData.get('password') as string
  const tierRaw = formData.get('tier') as string

  const tier = (VALID_TIERS as readonly string[]).includes(tierRaw) ? tierRaw : 'starter'

  if (!name || !email || !password) {
    redirect(`/signup?error=missing_fields&tier=${tier}`)
  }
  if (password.length < 8) {
    redirect(`/signup?error=weak_password&tier=${tier}`)
  }

  const [first_name, ...rest] = name.split(' ')
  const last_name = rest.join(' ') || first_name

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name, last_name } },
  })

  if (error) {
    console.error('[signup] error:', error.message)
    const code = error.message.toLowerCase().includes('already registered') ? 'email_exists' : 'signup_failed'
    redirect(`/signup?error=${code}&tier=${tier}`)
  }

  // enable_confirmations is false locally (supabase/config.toml) so signUp()
  // returns a live session immediately; a production deployment with email
  // confirmation on would instead need a "check your email" interstitial here.
  redirect(`/onboarding?tier=${tier}`)
}
