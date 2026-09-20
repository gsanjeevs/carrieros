// lib/password-policy.ts
// Client/server-side mirror of the Supabase Auth password rules in
// supabase/config.toml ([auth] minimum_password_length + password_requirements
// = lower_upper_letters_digits). Supabase is the enforcement point; this exists
// so signup can fail fast with a localized message instead of a round trip.
// tests/password-policy.test.ts fails if this drifts from config.toml.
export const MIN_PASSWORD_LENGTH = 12

export function passwordMeetsPolicy(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  )
}
