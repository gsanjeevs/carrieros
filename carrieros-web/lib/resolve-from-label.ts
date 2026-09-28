// lib/resolve-from-label.ts
// Resolves the `fromLabel` navigation-context query param (see
// lib/exceptions.ts's FROM_EXCEPTIONS comment and components/ui/PageBackLink.tsx)
// into a localized display string. `fromLabel` is a STABLE KEY set by the
// origin page, never literal text — this is what makes that safe: an
// unrecognized or absent key resolves to `null`, letting PageBackLink fall
// back to its own localized `defaultLabel` instead of ever rendering
// untranslated or attacker-controlled text from the URL.
import { getTranslations } from 'next-intl/server'

const FROM_LABEL_KEY_TO_NAV_KEY = {
  exceptions: 'exceptions',
} as const

export type FromLabelKey = keyof typeof FROM_LABEL_KEY_TO_NAV_KEY

export async function resolveFromLabel(key: string | undefined): Promise<string | undefined> {
  if (!key || !(key in FROM_LABEL_KEY_TO_NAV_KEY)) return undefined
  const tNav = await getTranslations('nav')
  return tNav(FROM_LABEL_KEY_TO_NAV_KEY[key as FromLabelKey] as never)
}
