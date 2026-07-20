// lib/api-errors.ts
// Maps API `error_code` values to friendly, user-facing English strings.
// `error` on API error responses is an internal debug string — never render
// it directly. Add new codes here as routes introduce them; swap this for a
// real i18n lookup later without touching call sites.

export const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:     "You don't have permission to do that.",
  NOT_ONBOARDED: 'Your company setup is incomplete.',
  VALIDATION_ERROR: 'Please check the form and try again.',
  SERVER_ERROR:  'Something went wrong. Please try again.',
}

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.'

export function friendlyApiError(errorCode?: string | null): string {
  if (!errorCode) return DEFAULT_MESSAGE
  return ERROR_MESSAGES[errorCode] ?? DEFAULT_MESSAGE
}
